-- Behavioural verification of ez_finance.scheduled_transactions.
--
-- The thing worth testing is not the table, it is the WORKER: catch-up, idempotency,
-- and the day-clamping arithmetic. None of it is executed by `db reset`.
--
-- Fixture UUIDs use the s1/s2 range, disjoint from the other suites.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('b1111111-0000-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sowner@test.local',    '', now(), now(), now()),
  ('b2222222-0000-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sstranger@test.local', '', now(), now(), now());

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;
create or replace function pg_temp.as_service_role() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
  perform set_config('role', 'service_role', false);
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
  if p_condition then raise notice 'PASS: %', p_label;
  else raise exception 'FAIL: %', p_label; end if;
end;
$$;
create or replace function pg_temp.rejects(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then raise notice 'PASS: % (%)', p_label, sqlerrm; return;
  end;
  raise exception 'FAIL: % — the statement was ACCEPTED', p_label;
end;
$$;

select pg_temp.as_postgres();

insert into ez_finance.workspaces (id, name, type, base_currency) values
  ('b1000000-0000-4000-8000-000000000001', 'Casa',  'personal', 'PEN'),
  ('b2000000-0000-4000-8000-000000000002', 'Otro',  'shared',   'PEN');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role) values
  ('b1000000-0000-4000-8000-000000000001', 'b1111111-0000-4000-8000-000000000201', '', 'owner'),
  ('b2000000-0000-4000-8000-000000000002', 'b1111111-0000-4000-8000-000000000201', '', 'owner');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance) values
  ('b1a00000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Banco',    'bank', 'PEN', 0),
  ('b2a00000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Del otro', 'bank', 'PEN', 0);

-- ===========================================================================
-- 1. Day clamping. "The 31st" must mean the END of a short month, not a skipped one.
-- ===========================================================================
select pg_temp.check(
  ez_finance_private.occurrence_in_month('2026-02-10'::date, 31::smallint) = '2026-02-28',
  'day 31 clamps to 28 in a non-leap February'
);
select pg_temp.check(
  ez_finance_private.occurrence_in_month('2024-02-10'::date, 31::smallint) = '2024-02-29',
  'day 31 clamps to 29 in a leap February'
);
select pg_temp.check(
  ez_finance_private.occurrence_in_month('2026-04-10'::date, 31::smallint) = '2026-04-30',
  'day 31 clamps to 30 in a 30-day month'
);
select pg_temp.check(
  ez_finance_private.occurrence_in_month('2026-03-20'::date, 5::smallint) = '2026-03-05',
  'an ordinary day is left alone'
);

-- ===========================================================================
-- 2. Transfers cannot be scheduled — a transfer is a tied PAIR, and one leg is corruption.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.scheduled_transactions
      (workspace_id, account_id, kind, base_amount, name, day_of_month)
    values ('b1000000-0000-4000-8000-000000000001','b1a00000-0000-4000-8000-000000000001',
            'transfer', 10000, 'Malo', 1)$$,
  'a transfer cannot be scheduled'
);

select pg_temp.rejects(
  $$insert into ez_finance.scheduled_transactions
      (workspace_id, account_id, kind, base_amount, name, day_of_month)
    values ('b1000000-0000-4000-8000-000000000001','b1a00000-0000-4000-8000-000000000001',
            'expense', 0, 'Cero', 1)$$,
  'a non-positive amount is refused'
);

-- ===========================================================================
-- 3. THE CROSS-WORKSPACE GUARD, again not covered by RLS: both accounts are visible
--    to this person, and only the trigger stops a schedule writing into the other
--    space every month, unattended.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.scheduled_transactions
      (workspace_id, account_id, kind, base_amount, name, day_of_month)
    values ('b1000000-0000-4000-8000-000000000001','b2a00000-0000-4000-8000-000000000002',
            'expense', 10000, 'Ajena', 1)$$,
  'a schedule cannot point at another workspace''s account'
);

-- ===========================================================================
-- 4. The worker is service_role only.
-- ===========================================================================
select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.materialise_due_transactions(int)', 'execute'),
  'anon cannot execute the worker'
);
select pg_temp.check(
  not has_function_privilege('authenticated', 'ez_finance.materialise_due_transactions(int)', 'execute'),
  'authenticated cannot execute the worker — this writes money unattended'
);
select pg_temp.check(
  has_function_privilege('service_role', 'ez_finance.materialise_due_transactions(int)', 'execute'),
  'service_role can execute the worker'
);

select pg_temp.as_user('b1111111-0000-4000-8000-000000000201');
select pg_temp.rejects(
  $$select ez_finance.materialise_due_transactions(10)$$,
  'a signed-in person cannot run the worker'
);

-- ===========================================================================
-- 5. CATCH-UP. A schedule created three months ago, never run, must produce every
--    missed occurrence — not just the most recent one.
-- ===========================================================================
select pg_temp.as_postgres();

insert into ez_finance.scheduled_transactions
  (id, workspace_id, account_id, kind, base_amount, name, day_of_month, created_at)
values
  ('b1500000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
   'b1a00000-0000-4000-8000-000000000001','expense', 50000, 'Alquiler', 1,
   (current_date - interval '3 months'));

select pg_temp.as_service_role();
select ez_finance.materialise_due_transactions(100);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where workspace_id = 'b1000000-0000-4000-8000-000000000001') >= 3,
  'a schedule three months stale produces every missed occurrence, not just the latest'
);

-- ===========================================================================
-- 6. IDEMPOTENCY. The whole reason the watermark exists.
-- ===========================================================================
select pg_temp.as_postgres();
create temporary table s_before as
  select count(*) as n from ez_finance.transactions
  where workspace_id = 'b1000000-0000-4000-8000-000000000001';

select pg_temp.as_service_role();
select ez_finance.materialise_due_transactions(100);
select ez_finance.materialise_due_transactions(100);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where workspace_id = 'b1000000-0000-4000-8000-000000000001')
  = (select n from s_before),
  'running the worker again creates NOTHING — the watermark holds'
);

-- ===========================================================================
-- 7. A paused schedule produces nothing.
-- ===========================================================================
select pg_temp.as_postgres();
insert into ez_finance.scheduled_transactions
  (id, workspace_id, account_id, kind, base_amount, name, day_of_month, created_at, paused_at)
values
  ('b1500000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001',
   'b1a00000-0000-4000-8000-000000000001','expense', 9900, 'Pausada', 1,
   (current_date - interval '2 months'), now());

create temporary table p_before as
  select count(*) as n from ez_finance.transactions
  where workspace_id = 'b1000000-0000-4000-8000-000000000001';

select pg_temp.as_service_role();
select ez_finance.materialise_due_transactions(100);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where workspace_id = 'b1000000-0000-4000-8000-000000000001')
  = (select n from p_before),
  'a paused schedule produces nothing'
);

-- ===========================================================================
-- 8. What it writes is an ORDINARY transaction: same table, right amount and kind,
--    so every balance, bucket and report already knows what to do with it.
-- ===========================================================================
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where workspace_id = 'b1000000-0000-4000-8000-000000000001'
     and kind = 'expense' and base_amount = 50000
     and entered_currency = 'PEN' and exchange_rate = 1) >= 3,
  'the rows are ordinary transactions in the workspace currency'
);

-- ===========================================================================
-- 9. RLS on the schedules themselves.
-- ===========================================================================
select pg_temp.as_user('b2222222-0000-4000-8000-000000000202');
select pg_temp.check(
  (select count(*) from ez_finance.scheduled_transactions
   where workspace_id = 'b1000000-0000-4000-8000-000000000001') = 0,
  'a stranger cannot read the schedules'
);

select 'ALL CHECKS PASSED' as result;
