-- Behavioural verification of ez_finance.budget_configs and budget_config_for().
--
-- The percentage rules are CHECKs and the "config in force for month M" rule is a
-- function body, so `db reset` proves none of it. The temporal behaviour is the
-- point: a config change must NOT rewrite the months that came before it.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('c1111111-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bowner@test.local',  '', now(), now(), now()),
  ('c2222222-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bmember@test.local', '', now(), now(), now());

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

insert into ez_finance.workspaces (id, name, type, base_currency)
values ('f0000000-0000-4000-8000-00000000000f', 'Mio', 'shared', 'PEN');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('f0000000-0000-4000-8000-00000000000f', 'c1111111-0000-4000-8000-000000000001', '', 'owner'),
  ('f0000000-0000-4000-8000-00000000000f', 'c2222222-0000-4000-8000-000000000002', '', 'member');

-- ===========================================================================
-- 1. No config yet — which is how the app knows onboarding is unfinished.
-- ===========================================================================
select pg_temp.as_user('c1111111-0000-4000-8000-000000000001');
select pg_temp.check(
  (select count(*) from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', current_date)) = 0,
  'budget_config_for returns NO row before any config exists'
);

-- ===========================================================================
-- 2. The default split, and a custom one. Both must be storable.
-- ===========================================================================
insert into ez_finance.budget_configs
  (workspace_id, effective_from, income_mode, expected_income, pct_need, pct_want, pct_save)
values ('f0000000-0000-4000-8000-00000000000f', '2026-01-01', 'mayor', 500000, 50, 30, 20);
select pg_temp.check(true, 'the 50/30/20 default is storable');

select pg_temp.rejects(
  $$insert into ez_finance.budget_configs
      (workspace_id, effective_from, expected_income, pct_need, pct_want, pct_save)
    values ('f0000000-0000-4000-8000-00000000000f', '2026-02-01', 0, 60, 30, 20)$$,
  'percentages that do not sum to 100 are refused'
);
select pg_temp.rejects(
  $$insert into ez_finance.budget_configs
      (workspace_id, effective_from, expected_income, pct_need, pct_want, pct_save)
    values ('f0000000-0000-4000-8000-00000000000f', '2026-02-01', 0, 110, 0, -10)$$,
  'a negative percentage is refused even when the sum is 100'
);
select pg_temp.rejects(
  $$insert into ez_finance.budget_configs
      (workspace_id, effective_from, expected_income, pct_need, pct_want, pct_save)
    values ('f0000000-0000-4000-8000-00000000000f', '2026-02-15', 0, 50, 30, 20)$$,
  'effective_from must be a month boundary'
);
select pg_temp.rejects(
  $$insert into ez_finance.budget_configs
      (workspace_id, effective_from, expected_income, pct_need, pct_want, pct_save)
    values ('f0000000-0000-4000-8000-00000000000f', '2026-03-01', -1, 50, 30, 20)$$,
  'a negative expected income is refused'
);

-- A person who wants 70/20/10 gets it: 50/30/20 is the default, not the rule.
insert into ez_finance.budget_configs
  (workspace_id, effective_from, income_mode, expected_income, pct_need, pct_want, pct_save)
values ('f0000000-0000-4000-8000-00000000000f', '2026-06-01', 'real', 800000, 70, 20, 10);
select pg_temp.check(true, 'a custom 70/20/10 split is storable');

-- ===========================================================================
-- 3. THE POINT OF THE TABLE: changing the config does not rewrite the past.
-- ===========================================================================
select pg_temp.check(
  (select expected_income from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2026-03-10')) = 500000,
  'March still sees the January config — the June change did not reach back'
);
select pg_temp.check(
  (select pct_need from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2026-03-10')) = 50,
  'and March keeps its 50/30/20 percentages'
);
select pg_temp.check(
  (select pct_need from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2026-07-10')) = 70,
  'July sees the new 70/20/10'
);
select pg_temp.check(
  (select income_mode from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2026-06-01')) = 'real',
  'the month a config starts in already uses it'
);
select pg_temp.check(
  (select effective_from from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2026-05-31')) = '2026-01-01',
  'the day before a change still resolves to the previous config'
);
select pg_temp.check(
  (select count(*) from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2025-12-01')) = 0,
  'a month BEFORE the first config has none — the engine is never handed a guess'
);

-- ===========================================================================
-- 4. One row per month boundary; a second edit updates it.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.budget_configs
      (workspace_id, effective_from, expected_income, pct_need, pct_want, pct_save)
    values ('f0000000-0000-4000-8000-00000000000f', '2026-01-01', 1, 50, 30, 20)$$,
  'a second config for the same month is refused — edit the existing row'
);

update ez_finance.budget_configs set expected_income = 550000
where workspace_id = 'f0000000-0000-4000-8000-00000000000f' and effective_from = '2026-01-01';
select pg_temp.check(
  (select expected_income from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2026-03-10')) = 550000,
  'editing a past config DOES change the months it governs — the point is that a NEW config does not'
);

-- ===========================================================================
-- 5. Spec §4: owner and admin manage the budget; a member only reads.
-- ===========================================================================
select pg_temp.as_user('c2222222-0000-4000-8000-000000000002');
select pg_temp.check(
  (select count(*) from ez_finance.budget_configs) = 2,
  'a member can READ the budget configs'
);
select pg_temp.rejects(
  $$insert into ez_finance.budget_configs
      (workspace_id, effective_from, expected_income, pct_need, pct_want, pct_save)
    values ('f0000000-0000-4000-8000-00000000000f', '2026-09-01', 0, 50, 30, 20)$$,
  'a member canNOT create one'
);

-- budget_config_for is SECURITY INVOKER, so a non-member reads nothing through it
-- rather than borrowing the function owner's rights.
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;
select pg_temp.as_anon();
select pg_temp.check(
  (select count(*) from ez_finance.budget_config_for(
     'f0000000-0000-4000-8000-00000000000f', '2026-03-10')) = 0,
  'anon reads nothing through budget_config_for — the function is INVOKER, not DEFINER'
);
select pg_temp.as_postgres();

select pg_temp.check(
  (select relrowsecurity from pg_class
   where relnamespace = 'ez_finance'::regnamespace and relname = 'budget_configs'),
  'RLS is enabled on budget_configs'
);

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
