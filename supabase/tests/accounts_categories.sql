-- Behavioural verification of ez_finance.accounts and ez_finance.categories.
--
-- Everything worth checking here lives in a trigger or a policy, and neither is
-- executed by `supabase db reset` — the migration applying proves only that the
-- SQL parses. Five rules are enforced in PL/pgSQL (currency immutable, bucket
-- immutable, parent same-workspace, parent one-level-only, no self-parent) and
-- the RLS split between "member" and "owner/admin" comes from spec §4, so all of
-- it is exercised the way the app reaches it: impersonating `authenticated` with
-- JWT claims.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures: an owner, an admin, a plain member and an outsider.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',    '', now(), now(), now()),
  ('22222222-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local',    '', now(), now(), now()),
  ('33333333-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@test.local',   '', now(), now(), now()),
  ('44444444-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@test.local', '', now(), now(), now());

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

/**
 * Run `p_sql` and report whether it raised. Used for the "must be rejected"
 * expectations: asserting that a trigger fires is only meaningful if the
 * statement would otherwise have succeeded.
 */
create or replace function pg_temp.rejects(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS: % (%)', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — the statement was ACCEPTED', p_label;
end;
$$;

-- ===========================================================================
-- 1. A shared workspace with one of each role, plus an untouched second
--    workspace to prove cross-workspace isolation later.
-- ===========================================================================
insert into ez_finance.workspaces (id, name, type)
values
  ('aaaa0000-0000-4000-8000-00000000000a', 'Casa',  'shared'),
  ('bbbb0000-0000-4000-8000-00000000000b', 'Otra',  'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('aaaa0000-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000001', '', 'owner'),
  ('aaaa0000-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000002', '', 'admin'),
  ('aaaa0000-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-000000000003', '', 'member'),
  -- The outsider owns the OTHER workspace, so "cannot see" is about membership
  -- rather than about having no workspace at all.
  ('bbbb0000-0000-4000-8000-00000000000b', '44444444-0000-4000-8000-000000000004', '', 'owner');

-- ===========================================================================
-- 2. Spec §4: managing accounts/categories is owner + admin only.
-- ===========================================================================
select pg_temp.as_user('11111111-0000-4000-8000-000000000001');
insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('acc00000-0000-4000-8000-00000000ac01', 'aaaa0000-0000-4000-8000-00000000000a', 'Efectivo', 'cash', 'ARS', 100000);
select pg_temp.check(true, 'owner can create an account');

select pg_temp.as_user('22222222-0000-4000-8000-000000000002');
insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('acc00000-0000-4000-8000-00000000ac02', 'aaaa0000-0000-4000-8000-00000000000a', 'Banco', 'bank', 'ARS', 0);
select pg_temp.check(true, 'admin can create an account');

select pg_temp.as_user('33333333-0000-4000-8000-000000000003');
select pg_temp.check(
  (select count(*) from ez_finance.accounts) = 2,
  'member can SELECT the workspace accounts'
);
select pg_temp.rejects(
  $$insert into ez_finance.accounts (workspace_id, name, type, currency)
    values ('aaaa0000-0000-4000-8000-00000000000a', 'Trucho', 'cash', 'ARS')$$,
  'member canNOT create an account'
);
-- ASYMMETRY WORTH KNOWING, and the reason this is not a rejects() check: a
-- denied INSERT RAISES ("new row violates row-level security policy"), but a
-- denied UPDATE does NOT. The USING clause filters the row out, so the statement
-- succeeds against zero rows. Any app code that infers "permission denied" from
-- an error will therefore report success on a forbidden edit — it has to check
-- the affected row count instead.
update ez_finance.accounts set name = 'Robado'
where id = 'acc00000-0000-4000-8000-00000000ac01';

select pg_temp.as_postgres();
select pg_temp.check(
  (select name from ez_finance.accounts where id = 'acc00000-0000-4000-8000-00000000ac01') = 'Efectivo',
  'a member''s rename silently affects no rows — the account is unchanged'
);

-- ===========================================================================
-- 3. Cross-workspace isolation.
-- ===========================================================================
select pg_temp.as_user('44444444-0000-4000-8000-000000000004');
select pg_temp.check(
  (select count(*) from ez_finance.accounts) = 0,
  'an outsider sees none of another workspace''s accounts'
);
select pg_temp.rejects(
  $$insert into ez_finance.accounts (workspace_id, name, type, currency)
    values ('aaaa0000-0000-4000-8000-00000000000a', 'Ajena', 'cash', 'ARS')$$,
  'an outsider canNOT create an account in a workspace they do not belong to'
);

-- ===========================================================================
-- 4. Account currency is immutable (trigger, not policy).
--    Runs as postgres: this must hold even for a caller RLS would allow.
-- ===========================================================================
select pg_temp.as_postgres();
select pg_temp.rejects(
  $$update ez_finance.accounts set currency = 'USD'
    where id = 'acc00000-0000-4000-8000-00000000ac01'$$,
  'account currency cannot be changed'
);
-- The trigger is scoped to the currency column, so unrelated updates must pass.
update ez_finance.accounts set name = 'Efectivo (caja)'
where id = 'acc00000-0000-4000-8000-00000000ac01';
select pg_temp.check(true, 'renaming an account still works');

-- ===========================================================================
-- 5. Archiving an account with a non-zero balance is allowed.
--    The balance is derived, so refusing would protect nothing.
-- ===========================================================================
update ez_finance.accounts set archived_at = now()
where id = 'acc00000-0000-4000-8000-00000000ac01';
select pg_temp.check(
  (select archived_at is not null from ez_finance.accounts where id = 'acc00000-0000-4000-8000-00000000ac01'),
  'an account with initial_balance <> 0 can be archived'
);

-- ===========================================================================
-- 6. Categories: hierarchy rules.
-- ===========================================================================
insert into ez_finance.categories (id, workspace_id, name, bucket)
values ('ca110000-0000-4000-8000-00000000ca01', 'aaaa0000-0000-4000-8000-00000000000a', 'Comida', 'need');

insert into ez_finance.categories (id, workspace_id, name, bucket, parent_id)
values ('ca110000-0000-4000-8000-00000000ca02', 'aaaa0000-0000-4000-8000-00000000000a', 'Delivery', 'want',
        'ca110000-0000-4000-8000-00000000ca01');
select pg_temp.check(true, 'a subcategory of a root category is accepted');

select pg_temp.rejects(
  $$insert into ez_finance.categories (workspace_id, name, bucket, parent_id)
    values ('aaaa0000-0000-4000-8000-00000000000a', 'Sushi', 'want',
            'ca110000-0000-4000-8000-00000000ca02')$$,
  'categories nest one level only — no grandchildren'
);

select pg_temp.rejects(
  $$insert into ez_finance.categories (workspace_id, name, bucket, parent_id)
    values ('bbbb0000-0000-4000-8000-00000000000b', 'Colada', 'need',
            'ca110000-0000-4000-8000-00000000ca01')$$,
  'a parent from another workspace is rejected'
);

select pg_temp.rejects(
  $$update ez_finance.categories set parent_id = id
    where id = 'ca110000-0000-4000-8000-00000000ca01'$$,
  'a category cannot be its own parent'
);

-- ===========================================================================
-- 7. Category bucket is immutable — the history-preservation rule.
-- ===========================================================================
select pg_temp.rejects(
  $$update ez_finance.categories set bucket = 'need'
    where id = 'ca110000-0000-4000-8000-00000000ca02'$$,
  'a category bucket cannot be re-assigned'
);
select pg_temp.rejects(
  $$update ez_finance.categories set bucket = null
    where id = 'ca110000-0000-4000-8000-00000000ca02'$$,
  'nor cleared to NULL (is distinct from, not <>)'
);

-- The sanctioned path: archive the old one, create the replacement. Both rows
-- coexist under the same name, which is why there is no unique (workspace, name).
update ez_finance.categories set archived_at = now()
where id = 'ca110000-0000-4000-8000-00000000ca02';

insert into ez_finance.categories (workspace_id, name, bucket, parent_id)
values ('aaaa0000-0000-4000-8000-00000000000a', 'Delivery', 'need',
        'ca110000-0000-4000-8000-00000000ca01');

select pg_temp.check(
  (select count(*) from ez_finance.categories
   where workspace_id = 'aaaa0000-0000-4000-8000-00000000000a' and name = 'Delivery') = 2,
  're-bucketing via archive + replace leaves both rows, old bucket intact'
);
select pg_temp.check(
  (select bucket from ez_finance.categories
   where id = 'ca110000-0000-4000-8000-00000000ca02') = 'want',
  'the archived row still carries the bucket its past transactions were spent under'
);

-- ===========================================================================
-- 8. An unbucketed category is allowed — the engine's documented NULL case.
-- ===========================================================================
insert into ez_finance.categories (workspace_id, name)
values ('aaaa0000-0000-4000-8000-00000000000a', 'Sin clasificar');
select pg_temp.check(true, 'a category with no bucket is accepted');

-- ===========================================================================
-- 9. Guards: RLS is actually on, and anon reaches nothing.
-- ===========================================================================
select pg_temp.check(
  (select bool_and(relrowsecurity) from pg_class
   where relnamespace = 'ez_finance'::regnamespace
   and   relname in ('accounts', 'categories')),
  'RLS is enabled on both tables'
);

-- NOT a grant check, on purpose. The fleet onboarding migration sets
--   alter default privileges ... grant all on tables to anon, authenticated, ...
-- so EVERY new table in ez_finance starts with full table privileges for anon.
-- That is Supabase's model — broad table grants, access decided by RLS — so
-- asserting on has_table_privilege would fail while proving nothing. What has to
-- hold is that anon cannot actually reach a row, which is what is checked here.
--
-- The corollary is worth stating: those grants mean a table shipped WITHOUT
-- `enable row level security` in this schema is readable and writable through
-- the publishable key, which ships to browsers. Locally there is no safety net
-- for that — public.rls_managed_schemas lists ez_finance, but the ensure_rls
-- event trigger that reads it lives in mvp-lab-infra and is NOT part of this
-- repo's migrations, so `supabase db reset` does not create it. Every table here
-- must enable RLS explicitly; nothing local will do it for you.
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;

select pg_temp.as_anon();
select pg_temp.check(
  (select count(*) from ez_finance.accounts)   = 0
  and (select count(*) from ez_finance.categories) = 0,
  'anon reads no rows from either table despite holding table grants'
);
select pg_temp.rejects(
  $$insert into ez_finance.accounts (workspace_id, name, type, currency)
    values ('aaaa0000-0000-4000-8000-00000000000a', 'Anonima', 'cash', 'ARS')$$,
  'anon canNOT insert an account'
);
select pg_temp.rejects(
  $$insert into ez_finance.categories (workspace_id, name, bucket)
    values ('aaaa0000-0000-4000-8000-00000000000a', 'Anonima', 'need')$$,
  'anon canNOT insert a category'
);
select pg_temp.as_postgres();

-- ===========================================================================
-- 10. bootstrap() seeds a starter category set into a NEW workspace.
--     The outsider has not been bootstrapped yet, so they are the clean subject.
--     Everything above built its workspaces by hand precisely so these counts
--     are not polluted by seeded rows.
-- ===========================================================================
select pg_temp.as_user('44444444-0000-4000-8000-000000000004');
select ez_finance.bootstrap() as personal_workspace \gset
select pg_temp.as_postgres();

select pg_temp.check(
  (select count(*) from ez_finance.categories where workspace_id = :'personal_workspace') = 11,
  'bootstrap seeds 11 starter categories'
);
select pg_temp.check(
  (select count(distinct bucket) from ez_finance.categories
   where workspace_id = :'personal_workspace') = 3,
  'the starter set covers all three buckets — an empty bucket would render as 0% forever'
);
select pg_temp.check(
  (select count(*) from ez_finance.categories
   where workspace_id = :'personal_workspace' and bucket is null) = 0,
  'no starter category is left unbucketed'
);
select pg_temp.check(
  (select count(*) from ez_finance.categories
   where workspace_id = :'personal_workspace' and parent_id is not null) = 0,
  'the starter set is flat — no imposed taxonomy'
);
select pg_temp.check(
  (select count(*) from ez_finance.accounts where workspace_id = :'personal_workspace') = 0,
  'NO account is seeded — its currency is immutable and would be a guess'
);

-- Idempotency: bootstrap runs on every login, so it must not re-seed. Archiving
-- a default and calling again must not resurrect it either.
update ez_finance.categories set archived_at = now()
where workspace_id = :'personal_workspace' and name = 'Ocio';

select pg_temp.as_user('44444444-0000-4000-8000-000000000004');
select ez_finance.bootstrap();
select pg_temp.as_postgres();

select pg_temp.check(
  (select count(*) from ez_finance.categories where workspace_id = :'personal_workspace') = 11,
  'a second bootstrap does not duplicate the starter set'
);
select pg_temp.check(
  (select archived_at is not null from ez_finance.categories
   where workspace_id = :'personal_workspace' and name = 'Ocio'),
  'nor resurrect a default the person archived'
);

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
