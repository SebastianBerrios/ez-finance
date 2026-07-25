-- Behavioural verification of the ez_finance account-deletion RPCs.
-- Runs as postgres but impersonates `authenticated` with JWT claims, which is
-- how the app actually reaches these functions.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures: two real auth.users rows (A deletes, B is a shared-workspace peer)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', '', now(), now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', '', now(), now(), now());

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

create or replace function pg_temp.check(p_condition boolean, p_label text) returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'PASS: %', p_label;
  else
    raise exception 'FAIL: %', p_label;
  end if;
end;
$$;

-- ===========================================================================
-- 1. Bootstrap both users, then build a SHARED workspace containing both.
-- ===========================================================================
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select ez_finance.bootstrap();
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
select ez_finance.bootstrap();
select pg_temp.as_postgres();

update ez_finance.profiles set display_name = 'Ana' where id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into ez_finance.workspaces (id, name, type)
values ('cccccccc-0000-4000-8000-000000000003', 'Casa', 'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', '', 'owner'),
  ('cccccccc-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'Beto', 'member');

-- ===========================================================================
-- 2. deletion_state() on a clean account reports ACTIVE.
-- ===========================================================================
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'ACTIVE',
  'clean account reports ACTIVE'
);

-- ===========================================================================
-- 3. request_account_deletion() opens a 30-day window.
-- ===========================================================================
-- NOTE: the result is captured into a variable first. `x BETWEEN a AND b`
-- expands to two comparisons, which would call this VOLATILE function twice
-- (the second call legitimately conflicting with the first).
do $$
declare
  v_window jsonb;
begin
  v_window := ez_finance.request_account_deletion();
  perform pg_temp.check(
    (v_window ->> 'ends_at')::timestamptz > now() + interval '29 days 23 hours'
      and (v_window ->> 'ends_at')::timestamptz < now() + interval '30 days 1 hour',
    'request opens a 30-day window'
  );
end;
$$;

select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'GRACE_PERIOD',
  'state reports GRACE_PERIOD after the request'
);

-- ===========================================================================
-- 4. A second request is a conflict (state machine: only valid from ACTIVE).
-- ===========================================================================
do $$
begin
  perform ez_finance.request_account_deletion();
  raise exception 'FAIL: a second request should have been rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'conflict' then
      raise notice 'PASS: second request rejected with conflict';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 5. A pending, not-yet-due request is NOT finalized.
-- ===========================================================================
select pg_temp.check(
  ez_finance.process_deletion_if_due() = false,
  'sweep leaves a not-yet-due request alone'
);
select pg_temp.check(
  exists (select 1 from ez_finance.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'profile survives while the window is open'
);

-- ===========================================================================
-- 6. cancel_account_deletion() returns the account to ACTIVE.
-- ===========================================================================
select ez_finance.cancel_account_deletion();
select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'ACTIVE',
  'cancel returns the account to ACTIVE'
);

-- ===========================================================================
-- 7. Cancelling with nothing pending is a conflict.
-- ===========================================================================
do $$
begin
  perform ez_finance.cancel_account_deletion();
  raise exception 'FAIL: cancel with nothing pending should be rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'conflict' then
      raise notice 'PASS: cancel with nothing pending rejected';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 8. Cancelling an EXPIRED window is a conflict (mirrors the domain guard).
-- ===========================================================================
select ez_finance.request_account_deletion();
select pg_temp.as_postgres();
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
and    cancelled_at is null and finalized_at is null;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');

do $$
begin
  perform ez_finance.cancel_account_deletion();
  raise exception 'FAIL: cancelling an expired window should be rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'conflict' then
      raise notice 'PASS: cancelling an expired window rejected';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 9. The sweep finalizes a DUE request — scoped erasure.
-- ===========================================================================
select pg_temp.check(
  ez_finance.process_deletion_if_due() = true,
  'sweep finalizes a due request'
);

select pg_temp.as_postgres();

select pg_temp.check(
  not exists (select 1 from ez_finance.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'profile erased'
);

select pg_temp.check(
  not exists (
    select 1 from ez_finance.workspaces w
    join ez_finance.workspace_members m on m.workspace_id = w.id
    where w.type = 'personal' and m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ),
  'personal workspace removed'
);

select pg_temp.check(
  exists (select 1 from ez_finance.workspaces where id = 'cccccccc-0000-4000-8000-000000000003'),
  'shared workspace survives'
);

select pg_temp.check(
  exists (
    select 1 from ez_finance.workspace_members
    where workspace_id = 'cccccccc-0000-4000-8000-000000000003'
    and   user_id is null
    and   display_name_snapshot = 'Ana'
  ),
  'shared membership tombstoned with the name snapshot'
);

select pg_temp.check(
  exists (
    select 1 from ez_finance.workspace_members
    where workspace_id = 'cccccccc-0000-4000-8000-000000000003'
    and   user_id = 'bbbbbbbb-0000-4000-8000-000000000002'
  ),
  'the other member is untouched'
);

select pg_temp.check(
  exists (select 1 from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'auth.users row is NEVER deleted (shared identity pool)'
);

select pg_temp.check(
  exists (
    select 1 from ez_finance_private.deletion_requests
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and finalized_at is not null
  ),
  'request stamped as finalized'
);

-- ===========================================================================
-- 10. The sweep is idempotent: a second run finds nothing due.
-- ===========================================================================
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.check(
  ez_finance.process_deletion_if_due() = false,
  'second sweep is a no-op'
);

-- ===========================================================================
-- 11. Peer B is completely unaffected.
-- ===========================================================================
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'ACTIVE',
  'peer account still ACTIVE'
);
select pg_temp.as_postgres();
select pg_temp.check(
  exists (select 1 from ez_finance.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'peer profile intact'
);

-- ===========================================================================
-- 12. Without a session every RPC refuses.
-- ===========================================================================
do $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'authenticated', false);
  perform ez_finance.deletion_state();
  raise exception 'FAIL: deletion_state without a session should be rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'session_not_found' then
      raise notice 'PASS: anonymous call rejected with session_not_found';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 13. The private ledger and the finalize helper are unreachable from the app.
-- ===========================================================================
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');

do $$
begin
  perform 1 from ez_finance_private.deletion_requests;
  raise exception 'FAIL: authenticated must not read the deletion ledger';
exception
  when insufficient_privilege then
    raise notice 'PASS: deletion ledger is unreadable by authenticated';
end;
$$;

do $$
begin
  perform ez_finance_private.finalize_deletion('aaaaaaaa-0000-4000-8000-000000000001');
  raise exception 'FAIL: authenticated must not call finalize_deletion directly';
exception
  when insufficient_privilege then
    raise notice 'PASS: finalize_deletion is not callable by authenticated';
end;
$$;

select pg_temp.as_postgres();
\echo 'ALL CHECKS PASSED'
