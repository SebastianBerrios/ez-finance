-- Behavioural verification of ez_finance.category_limits and budget_config_for().
--
-- Two rules carry the weight here.
--
-- THE CROSS-WORKSPACE GUARD, which RLS does NOT cover: a person with two spaces can
-- legitimately see both, so every id in a row can pass a policy while belonging to a
-- different space than the row claims. Only the trigger compares them.
--
-- AND THE PER-CONFIG SCOPING, which is what makes a limit part of a budget VERSION
-- rather than a property of the workspace: raising a ceiling this month must not
-- rewrite what an earlier month was measured against.
--
-- Fixture UUIDs use the c1/c2 range, disjoint from the other suites.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('c1111111-0000-4000-8000-000000000401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lowner@test.local',  '', now(), now(), now()),
  ('c2222222-0000-4000-8000-000000000402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lmember@test.local', '', now(), now(), now());

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
-- Fixtures: TWO workspaces owned by the SAME person — which is what makes the
-- cross-workspace checks meaningful, since both are legitimately visible — plus a
-- member with no management rights.
-- ---------------------------------------------------------------------------
insert into ez_finance.workspaces (id, name, type)
values
  ('c0000000-0000-4000-8000-0000000000c1', 'Casa',   'shared'),
  ('c0000000-0000-4000-8000-0000000000c2', 'Ajeno',  'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('c0000000-0000-4000-8000-0000000000c1', 'c1111111-0000-4000-8000-000000000401', '', 'owner'),
  ('c0000000-0000-4000-8000-0000000000c1', 'c2222222-0000-4000-8000-000000000402', '', 'member'),
  ('c0000000-0000-4000-8000-0000000000c2', 'c1111111-0000-4000-8000-000000000401', '', 'owner');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values
  ('c0000000-0000-4000-8000-00000000ac01', 'c0000000-0000-4000-8000-0000000000c1', 'Efectivo', 'cash', 'PEN', 0),
  ('c0000000-0000-4000-8000-00000000ac02', 'c0000000-0000-4000-8000-0000000000c2', 'Efectivo', 'cash', 'PEN', 0);

insert into ez_finance.categories (id, workspace_id, name, bucket)
values
  ('c0000000-0000-4000-8000-00000000ca01', 'c0000000-0000-4000-8000-0000000000c1', 'Mercado', 'need'),
  ('c0000000-0000-4000-8000-00000000ca02', 'c0000000-0000-4000-8000-0000000000c2', 'Ajena',   'need');

-- Two config VERSIONS in the first workspace: March and April.
insert into ez_finance.budget_configs
  (id, workspace_id, effective_from, income_mode, expected_income, pct_need, pct_want, pct_save)
values
  ('c0000000-0000-4000-8000-00000000cf01', 'c0000000-0000-4000-8000-0000000000c1', '2026-03-01', 'mayor', 500000, 50, 30, 20),
  ('c0000000-0000-4000-8000-00000000cf02', 'c0000000-0000-4000-8000-0000000000c1', '2026-04-01', 'mayor', 500000, 50, 30, 20),
  ('c0000000-0000-4000-8000-00000000cf03', 'c0000000-0000-4000-8000-0000000000c2', '2026-03-01', 'mayor', 500000, 50, 30, 20);

-- ===========================================================================
-- 1. The owner sets a ceiling.
-- ===========================================================================
select pg_temp.as_user('c1111111-0000-4000-8000-000000000401');

insert into ez_finance.category_limits
  (workspace_id, budget_config_id, category_id, limit_amount)
values
  ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf01',
   'c0000000-0000-4000-8000-00000000ca01', 40000);

select pg_temp.as_postgres();
select pg_temp.check(
  (select limit_amount from ez_finance.category_limits
   where budget_config_id = 'c0000000-0000-4000-8000-00000000cf01') = 40000,
  'the owner sets a category limit'
);

-- ===========================================================================
-- 2. Zero and negative are refused. A ceiling of zero is a prohibition, not a
--    budget: the engine would read every peso spent as over it.
-- ===========================================================================
select pg_temp.as_user('c1111111-0000-4000-8000-000000000401');
select pg_temp.rejects(
  $$insert into ez_finance.category_limits
      (workspace_id, budget_config_id, category_id, limit_amount)
    values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf02',
            'c0000000-0000-4000-8000-00000000ca01', 0)$$,
  'a limit of zero is refused'
);
select pg_temp.rejects(
  $$insert into ez_finance.category_limits
      (workspace_id, budget_config_id, category_id, limit_amount)
    values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf02',
            'c0000000-0000-4000-8000-00000000ca01', -100)$$,
  'nor a negative one'
);

-- ===========================================================================
-- 3. THE CROSS-WORKSPACE GUARD. Every id below is one the caller can legitimately
--    see — they own both spaces — which is exactly why RLS cannot catch this.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.category_limits
      (workspace_id, budget_config_id, category_id, limit_amount)
    values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf01',
            'c0000000-0000-4000-8000-00000000ca02', 40000)$$,
  'a category from ANOTHER space cannot be given a limit here'
);
select pg_temp.rejects(
  $$insert into ez_finance.category_limits
      (workspace_id, budget_config_id, category_id, limit_amount)
    values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf03',
            'c0000000-0000-4000-8000-00000000ca01', 40000)$$,
  'nor can a config from another space be the one it hangs off'
);

-- ===========================================================================
-- 4. Spec §4: only owner and admin manage the budget. A MEMBER may read it and
--    may not write it — a limit IS budget configuration.
-- ===========================================================================
select pg_temp.as_user('c2222222-0000-4000-8000-000000000402');
select pg_temp.check(
  (select count(*) from ez_finance.category_limits
   where workspace_id = 'c0000000-0000-4000-8000-0000000000c1') = 1,
  'a member READS the limits of their space'
);
select pg_temp.rejects(
  $$insert into ez_finance.category_limits
      (workspace_id, budget_config_id, category_id, limit_amount)
    values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf02',
            'c0000000-0000-4000-8000-00000000ca01', 90000)$$,
  'a member cannot SET one'
);

-- A refused UPDATE and DELETE raise nothing — they match zero rows — so these
-- assert on the surviving value.
update ez_finance.category_limits set limit_amount = 1
where  budget_config_id = 'c0000000-0000-4000-8000-00000000cf01';
delete from ez_finance.category_limits
where  budget_config_id = 'c0000000-0000-4000-8000-00000000cf01';

select pg_temp.as_postgres();
select pg_temp.check(
  (select limit_amount from ez_finance.category_limits
   where budget_config_id = 'c0000000-0000-4000-8000-00000000cf01') = 40000,
  'nor edit or delete one (silently affects no rows)'
);

-- ===========================================================================
-- 5. One limit per category per CONFIG — the upsert the app performs depends on
--    this primary key, and the same category may have a different ceiling in a
--    later month.
-- ===========================================================================
select pg_temp.as_user('c1111111-0000-4000-8000-000000000401');
select pg_temp.rejects(
  $$insert into ez_finance.category_limits
      (workspace_id, budget_config_id, category_id, limit_amount)
    values ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf01',
            'c0000000-0000-4000-8000-00000000ca01', 90000)$$,
  'the same category cannot have two limits on one config'
);

insert into ez_finance.category_limits
  (workspace_id, budget_config_id, category_id, limit_amount)
values
  ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000cf02',
   'c0000000-0000-4000-8000-00000000ca01', 90000);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.category_limits
   where category_id = 'c0000000-0000-4000-8000-00000000ca01') = 2,
  'but it CAN have a different one in a later month'
);

-- ===========================================================================
-- 6. budget_config_for() answers with the limits of the config IN FORCE, and
--    with no others. This is the whole reason limits hang off a config version.
-- ===========================================================================
select pg_temp.as_user('c1111111-0000-4000-8000-000000000401');

select pg_temp.check(
  (select (category_limits -> 0 ->> 'limit_amount')
   from   ez_finance.budget_config_for('c0000000-0000-4000-8000-0000000000c1', '2026-03-15')) = '40000',
  'March reads March''s ceiling'
);

select pg_temp.check(
  (select (category_limits -> 0 ->> 'limit_amount')
   from   ez_finance.budget_config_for('c0000000-0000-4000-8000-0000000000c1', '2026-05-15')) = '90000',
  'May inherits APRIL''s, not March''s — raising a ceiling does not rewrite history'
);

select pg_temp.check(
  (select pg_catalog.jsonb_array_length(category_limits)
   from   ez_finance.budget_config_for('c0000000-0000-4000-8000-0000000000c1', '2026-03-15')) = 1,
  'and it carries only that config''s limits'
);

-- An amount as TEXT, not a json number: a bigint through a double loses precision
-- past 2^53, and every amount in this app crosses the wire as a string for that reason.
select pg_temp.check(
  (select pg_catalog.jsonb_typeof(category_limits -> 0 -> 'limit_amount')
   from   ez_finance.budget_config_for('c0000000-0000-4000-8000-0000000000c1', '2026-03-15')) = 'string',
  'the amount is a STRING in the payload, so a bigint cannot be rounded by a JSON double'
);

-- A config with no limits answers with [] rather than null, so the caller has one
-- shape to read.
select pg_temp.check(
  (select category_limits
   from   ez_finance.budget_config_for('c0000000-0000-4000-8000-0000000000c2', '2026-03-15')) = '[]'::jsonb,
  'a config with no limits answers [] and not null'
);

-- ===========================================================================
-- 7. Guards.
-- ===========================================================================
select pg_temp.as_postgres();
select pg_temp.check(
  (select relrowsecurity from pg_class
   where relnamespace = 'ez_finance'::regnamespace and relname = 'category_limits'),
  'RLS is enabled on category_limits'
);

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;
select pg_temp.as_anon();
select pg_temp.check(
  (select count(*) from ez_finance.category_limits) = 0,
  'anon reads no limits despite the schema-wide table grants'
);
select pg_temp.as_postgres();

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
