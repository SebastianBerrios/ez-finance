-- Behavioural verification of ez_finance.goals and goal_progress().
--
-- The rules that matter are a trigger body, a set of policies and a function — none of
-- which `db reset` executes. The one worth reading first is the cross-workspace guard:
-- RLS does NOT cover it, because a person with two spaces can legitimately see both,
-- so only the trigger stops a goal in one measuring an account in the other.
--
-- Fixture UUIDs use the g1/g2 range, disjoint from the other suites.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1111111-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gowner@test.local',    '', now(), now(), now()),
  ('a2222222-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gstranger@test.local', '', now(), now(), now());

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

-- ---------------------------------------------------------------------------
-- Fixtures: two workspaces owned by the SAME person, each with an account. That is
-- what makes the cross-workspace check meaningful — both are legitimately visible.
-- ---------------------------------------------------------------------------
select pg_temp.as_postgres();

insert into ez_finance.workspaces (id, name, type, base_currency) values
  ('a1000000-0000-4000-8000-000000000001', 'Casa',    'personal', 'PEN'),
  ('a2000000-0000-4000-8000-000000000002', 'Negocio', 'shared',   'PEN');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role) values
  ('a1000000-0000-4000-8000-000000000001', 'a1111111-0000-4000-8000-000000000101', '', 'owner'),
  ('a2000000-0000-4000-8000-000000000002', 'a1111111-0000-4000-8000-000000000101', '', 'owner');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance) values
  ('a1a00000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Ahorros',  'savings', 'PEN', 50000),
  ('a2a00000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'Del otro', 'savings', 'PEN', 999900);

-- ===========================================================================
-- 1. The amount must be positive. A goal of zero is reached the moment it exists.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.goals (workspace_id, account_id, name, target_amount)
    values ('a1000000-0000-4000-8000-000000000001','a1a00000-0000-4000-8000-000000000001','Cero',0)$$,
  'a target of zero is refused'
);
select pg_temp.rejects(
  $$insert into ez_finance.goals (workspace_id, account_id, name, target_amount)
    values ('a1000000-0000-4000-8000-000000000001','a1a00000-0000-4000-8000-000000000001','Negativo',-100)$$,
  'a negative target is refused'
);

-- ===========================================================================
-- 2. Name bounds, matching the column CHECK on the trimmed value.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.goals (workspace_id, account_id, name, target_amount)
    values ('a1000000-0000-4000-8000-000000000001','a1a00000-0000-4000-8000-000000000001','   ',100000)$$,
  'a whitespace-only name is refused'
);

-- ===========================================================================
-- 3. THE CROSS-WORKSPACE GUARD, which RLS does not provide.
--
--    Both workspaces belong to the same person, so both accounts are legitimately
--    visible to them. Only the trigger stops a goal in one measuring the other's
--    money — and without it the goal would show progress the space does not have.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.goals (workspace_id, account_id, name, target_amount)
    values ('a1000000-0000-4000-8000-000000000001','a2a00000-0000-4000-8000-000000000002','Ajena',100000)$$,
  'a goal cannot point at another workspace''s account'
);

-- The same guard on UPDATE, because a goal created correctly could otherwise be
-- repointed afterwards.
insert into ez_finance.goals (id, workspace_id, account_id, name, target_amount, target_date) values
  ('a1600000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
   'a1a00000-0000-4000-8000-000000000001','Viaje',200000,'2026-12-31');

select pg_temp.rejects(
  $$update ez_finance.goals set account_id = 'a2a00000-0000-4000-8000-000000000002'
    where id = 'a1600000-0000-4000-8000-000000000001'$$,
  'a goal cannot be REPOINTED at another workspace''s account'
);

-- ===========================================================================
-- 4. Progress is DERIVED, never stored. The account opened at 500.00.
-- ===========================================================================
select pg_temp.as_user('a1111111-0000-4000-8000-000000000101');

select pg_temp.check(
  (select saved_amount from ez_finance.goal_progress('a1000000-0000-4000-8000-000000000001')
   where id = 'a1600000-0000-4000-8000-000000000001') = 50000,
  'progress is the account balance, not a stored column'
);

select pg_temp.check(
  (select account_name from ez_finance.goal_progress('a1000000-0000-4000-8000-000000000001')
   where id = 'a1600000-0000-4000-8000-000000000001') = 'Ahorros',
  'the account behind the goal is named'
);

-- Money arriving MOVES the goal, with nothing else written.
select pg_temp.as_postgres();
insert into ez_finance.transactions
  (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency, exchange_rate, occurred_on, created_by)
values
  ('a1000000-0000-4000-8000-000000000001','a1a00000-0000-4000-8000-000000000001','income',
   30000, 30000, 'PEN', 1, current_date, 'a1111111-0000-4000-8000-000000000101');

select pg_temp.as_user('a1111111-0000-4000-8000-000000000101');
select pg_temp.check(
  (select saved_amount from ez_finance.goal_progress('a1000000-0000-4000-8000-000000000001')
   where id = 'a1600000-0000-4000-8000-000000000001') = 80000,
  'recording income moves the goal without touching the goal row'
);

-- Saving PAST the target is not an error.
select pg_temp.as_postgres();
insert into ez_finance.transactions
  (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency, exchange_rate, occurred_on, created_by)
values
  ('a1000000-0000-4000-8000-000000000001','a1a00000-0000-4000-8000-000000000001','income',
   500000, 500000, 'PEN', 1, current_date, 'a1111111-0000-4000-8000-000000000101');

select pg_temp.as_user('a1111111-0000-4000-8000-000000000101');
select pg_temp.check(
  (select saved_amount > target_amount from ez_finance.goal_progress('a1000000-0000-4000-8000-000000000001')
   where id = 'a1600000-0000-4000-8000-000000000001'),
  'saving past the target is reported, not clamped'
);

-- ===========================================================================
-- 5. Archived goals leave the progress list but not the table.
-- ===========================================================================
select pg_temp.as_postgres();
update ez_finance.goals set archived_at = now()
where id = 'a1600000-0000-4000-8000-000000000001';

select pg_temp.as_user('a1111111-0000-4000-8000-000000000101');
select pg_temp.check(
  (select count(*) from ez_finance.goal_progress('a1000000-0000-4000-8000-000000000001')) = 0,
  'an archived goal is not listed'
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.goals where id = 'a1600000-0000-4000-8000-000000000001') = 1,
  'the archived row still exists'
);
update ez_finance.goals set archived_at = null
where id = 'a1600000-0000-4000-8000-000000000001';

-- ===========================================================================
-- 6. RLS. A stranger sees nothing and can write nothing.
-- ===========================================================================
select pg_temp.as_user('a2222222-0000-4000-8000-000000000102');

select pg_temp.check(
  (select count(*) from ez_finance.goals
   where workspace_id = 'a1000000-0000-4000-8000-000000000001') = 0,
  'a stranger cannot read the goals'
);

select pg_temp.check(
  (select count(*) from ez_finance.goal_progress('a1000000-0000-4000-8000-000000000001')) = 0,
  'goal_progress is SECURITY INVOKER, so a stranger reads nothing through it'
);

select pg_temp.rejects(
  $$insert into ez_finance.goals (workspace_id, account_id, name, target_amount)
    values ('a1000000-0000-4000-8000-000000000001','a1a00000-0000-4000-8000-000000000001','Intruso',100000)$$,
  'a stranger cannot insert a goal'
);

-- ===========================================================================
-- 7. Grants, same rule as every other ez_finance routine.
-- ===========================================================================
select pg_temp.as_postgres();

select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.goal_progress(uuid)', 'execute'),
  'anon cannot execute goal_progress'
);
select pg_temp.check(
  not has_function_privilege('public', 'ez_finance.goal_progress(uuid)', 'execute'),
  'PUBLIC cannot execute goal_progress'
);
select pg_temp.check(
  has_function_privilege('authenticated', 'ez_finance.goal_progress(uuid)', 'execute'),
  'authenticated can execute goal_progress'
);

select 'ALL CHECKS PASSED' as result;
