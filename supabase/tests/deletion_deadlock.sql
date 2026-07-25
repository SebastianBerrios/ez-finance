-- Concurrency regression for the account-deletion pipeline.
--
-- WHAT THIS PINS: the scheduled worker (ez_finance.process_due_deletions) and a
-- returning user (ez_finance.process_deletion_if_due -> finalize_deletion) must
-- acquire the per-user ADVISORY lock and the deletion_requests ROW lock in the
-- SAME order. When they do not, the two paths deadlock:
--
--   ERROR:  deadlock detected
--   DETAIL: Process A waits for ShareLock on transaction N; blocked by B.
--           Process B waits for ExclusiveLock on advisory lock [...]; blocked by A.
--   CONTEXT: while updating tuple (0,1) in relation "deletion_requests"
--
-- and the worker's `exception when others` silently counted the victim as a
-- skipped row, so the failure was invisible in production.
--
-- HOW IT DRIVES TWO SESSIONS: dblink. One connection plays the returning user,
-- the other plays the worker, and a BEFORE DELETE trigger on ez_finance.profiles
-- parks whichever path gets there first INSIDE finalize_deletion — after it took
-- the advisory lock, before it stamps deletion_requests. That is exactly the
-- window in which the two lock orders can cross.
--
-- The verdict does not depend on either function's return shape: it reads
-- pg_stat_database.deadlocks, which the deadlock detector bumps whether or not
-- the caller swallows the error.
--
--   docker cp supabase/tests/deletion_deadlock.sql supabase_db_ez-finance:/tmp/d.sql
--   MSYS_NO_PATHCONV=1 docker exec -e PGPASSWORD=postgres supabase_db_ez-finance \
--     sh -c 'psql -h "$(hostname -i)" -U postgres -d postgres -f /tmp/d.sql'
--
-- WHY THE TCP INVOCATION: `postgres` is NOT a superuser on Supabase, and dblink
-- refuses a non-superuser connection that did not actually present a password.
-- 127.0.0.1 and the unix socket are `trust` in the local stack's pg_hba, so the
-- loopback route is rejected; the container's own network address falls under
-- the scram-sha-256 rule and works. dblink_connect_u (the unrestricted variant)
-- is not an option either: the extension is owned by supabase_admin and only it
-- holds EXECUTE.
--
-- Run it against a freshly reset LOCAL stack (`supabase db reset`). It leaves
-- two erased fixture accounts behind, like the behavioural suite next to it.
\set ON_ERROR_STOP on

create extension if not exists dblink;

-- The two sub-sessions dial back into THIS server. Derived, not hardcoded, so
-- the script keeps working when the container's address changes. It is stashed
-- in a GUC rather than a psql variable because psql does NOT interpolate `:var`
-- inside the dollar-quoted DO blocks below.
select set_config(
         'deadlock_test.dsn',
         coalesce(
           'hostaddr=' || host(inet_server_addr()) ||
           ' port='    || inet_server_port() ||
           ' dbname='  || current_database() ||
           ' user=postgres password=postgres',
           ''
         ),
         false
       );

create or replace function pg_temp.check(p_condition boolean, p_label text) returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'PASS: %', p_label;
  else
    raise exception 'FAIL: %', p_label;
  end if;
end;
$$;

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claims', '', false);
end;
$$;

select pg_temp.check(
  current_setting('deadlock_test.dsn') <> '',
  'the script is running over TCP (see the header) so dblink can present a password'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two accounts with a due deletion request each.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('dddddddd-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deadlock1@test.local', '', now(), now(), now()),
  ('dddddddd-0000-4000-8000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deadlock2@test.local', '', now(), now(), now());

select pg_temp.as_user('dddddddd-0000-4000-8000-0000000000d1');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

select pg_temp.as_user('dddddddd-0000-4000-8000-0000000000d2');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

select pg_temp.as_postgres();

-- Only the FIRST account is due to begin with: scenario 1 must race exactly one
-- row, or the worker's batch would lock the second one too and blur the trace.
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = 'dddddddd-0000-4000-8000-0000000000d1'
and    cancelled_at is null and finalized_at is null;

-- The lever. finalize_deletion() deletes the profile between taking the
-- advisory lock and stamping deletion_requests, so sleeping here holds the
-- advisory lock open with the row lock still unclaimed.
create function public.ez_finance_test_slow_delete() returns trigger
  language plpgsql as $$
begin
  if old.id in (
    'dddddddd-0000-4000-8000-0000000000d1',
    'dddddddd-0000-4000-8000-0000000000d2'
  ) then
    perform pg_sleep(3);
  end if;
  return old;
end;
$$;

create trigger ez_finance_test_slow_delete
  before delete on ez_finance.profiles
  for each row execute function public.ez_finance_test_slow_delete();

select deadlocks as dl_before
from   pg_stat_database
where  datname = current_database()
\gset

-- ===========================================================================
-- SCENARIO 1 — the returning USER gets there first.
--   user:   advisory lock ... (parked) ... update deletion_requests
--   worker: starts 1s later and must not take the row lock before the advisory
--           lock, or the two cross and Postgres kills one of them.
-- ===========================================================================
do $$
declare
  v_dsn      text := current_setting('deadlock_test.dsn');
  v_u_result text;
  v_w_result text;
  v_u_error  text := '';
  v_w_error  text := '';
begin
  perform dblink_connect('dl_user', v_dsn);
  perform dblink_connect('dl_worker', v_dsn);

  perform dblink_send_query(
    'dl_user',
    $q$select ez_finance_private.finalize_deletion('dddddddd-0000-4000-8000-0000000000d1')::text$q$
  );
  perform pg_sleep(1);

  begin
    select r into v_w_result
    from   dblink('dl_worker', $q$select ez_finance.process_due_deletions(10)::text$q$) as t(r text);
  exception when others then
    v_w_error := sqlstate || ' ' || sqlerrm;
  end;

  begin
    select r into v_u_result
    from   dblink_get_result('dl_user') as t(r text);
  exception when others then
    v_u_error := sqlstate || ' ' || sqlerrm;
  end;

  begin
    perform * from dblink_get_result('dl_user') as t(r text);
  exception when others then
    null;
  end;

  perform dblink_disconnect('dl_user');
  perform dblink_disconnect('dl_worker');

  raise notice 'scenario 1 — user: % [%] | worker: % [%]',
    v_u_result, v_u_error, v_w_result, v_w_error;

  perform pg_temp.check(
    v_u_error = '',
    'user-first: the returning user finalization raises nothing'
  );
  perform pg_temp.check(
    v_w_error = '',
    'user-first: the worker raises nothing'
  );
  perform pg_temp.check(
    v_u_result = 'true',
    'user-first: the user path is the one that erased the data'
  );
end;
$$;

select pg_temp.check(
  exists (
    select 1 from ez_finance_private.deletion_requests
    where user_id = 'dddddddd-0000-4000-8000-0000000000d1' and finalized_at is not null
  ),
  'user-first: the request ended up finalized'
);

-- ===========================================================================
-- SCENARIO 2 — the WORKER gets there first, the user arrives mid-erasure.
--   The reverse interleaving. It never deadlocked, and it must stay that way
--   after reordering the worker's locks.
-- ===========================================================================
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = 'dddddddd-0000-4000-8000-0000000000d2'
and    cancelled_at is null and finalized_at is null;

do $$
declare
  v_dsn      text := current_setting('deadlock_test.dsn');
  v_u_result text;
  v_w_result text;
  v_u_error  text := '';
  v_w_error  text := '';
begin
  perform dblink_connect('dl_user', v_dsn);
  perform dblink_connect('dl_worker', v_dsn);

  perform dblink_send_query(
    'dl_worker',
    $q$select ez_finance.process_due_deletions(10)::text$q$
  );
  perform pg_sleep(1);

  begin
    select r into v_u_result
    from   dblink('dl_user', $q$select ez_finance_private.finalize_deletion('dddddddd-0000-4000-8000-0000000000d2')::text$q$) as t(r text);
  exception when others then
    v_u_error := sqlstate || ' ' || sqlerrm;
  end;

  begin
    select r into v_w_result
    from   dblink_get_result('dl_worker') as t(r text);
  exception when others then
    v_w_error := sqlstate || ' ' || sqlerrm;
  end;

  begin
    perform * from dblink_get_result('dl_worker') as t(r text);
  exception when others then
    null;
  end;

  perform dblink_disconnect('dl_user');
  perform dblink_disconnect('dl_worker');

  raise notice 'scenario 2 — worker: % [%] | user: % [%]',
    v_w_result, v_w_error, v_u_result, v_u_error;

  perform pg_temp.check(
    v_w_error = '',
    'worker-first: the worker raises nothing'
  );
  perform pg_temp.check(
    v_u_error = '',
    'worker-first: the returning user raises nothing'
  );
  perform pg_temp.check(
    v_u_result = 'false',
    'worker-first: the user finds nothing left to do'
  );
end;
$$;

select pg_temp.check(
  exists (
    select 1 from ez_finance_private.deletion_requests
    where user_id = 'dddddddd-0000-4000-8000-0000000000d2' and finalized_at is not null
  ),
  'worker-first: the request ended up finalized'
);

-- ===========================================================================
-- The verdict. Independent of what either function returns or swallows.
-- ===========================================================================
select pg_sleep(1);
select pg_stat_clear_snapshot();

select pg_temp.check(
  (select deadlocks from pg_stat_database where datname = current_database()) = :dl_before,
  'no deadlock was detected while the two lock orders raced'
);

drop trigger ez_finance_test_slow_delete on ez_finance.profiles;
drop function public.ez_finance_test_slow_delete();
drop extension dblink;

\echo 'ALL CONCURRENCY CHECKS PASSED'
