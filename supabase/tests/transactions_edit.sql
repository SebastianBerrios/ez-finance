-- Behavioural verification of the transactions UPDATE policy.
--
-- The rule worth reading first: a TRANSFER LEG IS NOT UPDATABLE. Raising the amount
-- on the 'out' leg alone would leave money departing at one figure and arriving at
-- another, and every CHECK on the table would still pass — transactions_kind_shape
-- constrains the shape of one leg, never the agreement between two. Only the policy
-- stops it, and a refused UPDATE RAISES NOTHING, so each check below asserts on the
-- surviving row rather than on an error.
--
-- Fixture UUIDs use the e1/e2 range, disjoint from the other suites.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('e1111111-0000-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eauthor@test.local',   '', now(), now(), now()),
  ('e2222222-0000-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eowner@test.local',    '', now(), now(), now()),
  ('e3333333-0000-4000-8000-000000000203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eobserver@test.local', '', now(), now(), now());

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
-- THE TWO WAYS A POLICY SAYS NO, because the checks below assert on different
-- things depending on which one applies and getting it backwards writes a test
-- that fails against correct code:
--
--   USING mismatch      → the row is FILTERED OUT of those the statement can
--                         match. Nothing changes and NOTHING IS RAISED, so the
--                         only evidence is the surviving row. (Someone else's
--                         movement; a transfer leg.)
--   WITH CHECK violation → the row would be matched, but the RESULT is not
--                         allowed. Postgres RAISES 42501. (An expense turned
--                         into a transfer; authorship reassigned.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Fixtures: a shared workspace, two accounts, one category, and three people —
-- the author of the movements, another owner, and an observer.
-- ---------------------------------------------------------------------------
insert into ez_finance.workspaces (id, name, type)
values ('e0000000-0000-4000-8000-0000000000ed', 'Edicion', 'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('e0000000-0000-4000-8000-0000000000ed', 'e1111111-0000-4000-8000-000000000201', '', 'member'),
  ('e0000000-0000-4000-8000-0000000000ed', 'e2222222-0000-4000-8000-000000000202', '', 'owner'),
  ('e0000000-0000-4000-8000-0000000000ed', 'e3333333-0000-4000-8000-000000000203', '', 'observer');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values
  ('e0000000-0000-4000-8000-00000000ae01', 'e0000000-0000-4000-8000-0000000000ed', 'Efectivo', 'cash',    'PEN', 100000),
  ('e0000000-0000-4000-8000-00000000ae02', 'e0000000-0000-4000-8000-0000000000ed', 'Ahorro',   'savings', 'PEN', 0);

insert into ez_finance.categories (id, workspace_id, name, bucket)
values
  ('e0000000-0000-4000-8000-00000000ac01', 'e0000000-0000-4000-8000-0000000000ed', 'Mercado', 'need'),
  ('e0000000-0000-4000-8000-00000000ac02', 'e0000000-0000-4000-8000-0000000000ed', 'Salidas', 'want');

-- The author records one expense and one transfer.
select pg_temp.as_user('e1111111-0000-4000-8000-000000000201');

insert into ez_finance.transactions
  (id, workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
   exchange_rate, occurred_on, category_id, note, created_by)
values
  ('e0000000-0000-4000-8000-00000000af01', 'e0000000-0000-4000-8000-0000000000ed',
   'e0000000-0000-4000-8000-00000000ae01', 'expense', 25000, 25000, 'PEN', 1,
   current_date, 'e0000000-0000-4000-8000-00000000ac01', 'Feria',
   'e1111111-0000-4000-8000-000000000201');

select ez_finance.record_transfer(
  'e0000000-0000-4000-8000-0000000000ed',
  'e0000000-0000-4000-8000-00000000ae01',
  'e0000000-0000-4000-8000-00000000ae02',
  50000, 50000, 'PEN', 1, current_date, 'Al ahorro'
) as tid \gset

-- ===========================================================================
-- 1. The author edits their own expense: amount, date, category and note.
-- ===========================================================================
update ez_finance.transactions
set    base_amount    = 31000,
       entered_amount = 31000,
       occurred_on    = current_date - 1,
       category_id    = 'e0000000-0000-4000-8000-00000000ac02',
       note           = 'Corregido'
where  id = 'e0000000-0000-4000-8000-00000000af01';

select pg_temp.as_postgres();
select pg_temp.check(
  (select base_amount = 31000
      and category_id = 'e0000000-0000-4000-8000-00000000ac02'
      and note        = 'Corregido'
      and occurred_on = current_date - 1
   from ez_finance.transactions
   where id = 'e0000000-0000-4000-8000-00000000af01'),
  'the author edits their own expense'
);

select pg_temp.check(
  (select updated_at > created_at from ez_finance.transactions
   where id = 'e0000000-0000-4000-8000-00000000af01'),
  'transactions_set_updated_at moved updated_at on the edit'
);

-- ===========================================================================
-- 2. NEITHER LEG OF A TRANSFER IS UPDATABLE — not even by its own author.
--    This is the rule the migration adds. Without it the pair stops adding up.
-- ===========================================================================
select pg_temp.as_user('e1111111-0000-4000-8000-000000000201');
update ez_finance.transactions
set    base_amount = 99000, entered_amount = 99000
where  transfer_id = :'tid' and transfer_leg = 'out';

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where transfer_id = :'tid' and base_amount = 50000) = 2,
  'a transfer leg is NOT updatable by its author — both legs still agree'
);

-- The date is no safer than the amount: one leg in March and the other in April
-- would put the two halves of one movement in different months.
select pg_temp.as_user('e1111111-0000-4000-8000-000000000201');
update ez_finance.transactions
set    occurred_on = current_date - 30
where  transfer_id = :'tid';

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(distinct occurred_on) from ez_finance.transactions
   where transfer_id = :'tid') = 1,
  'nor is its date — the pair cannot be split across months'
);

-- ===========================================================================
-- 3. An expense cannot be turned INTO a transfer.
--    This one RAISES rather than passing silently, and that is the WITH CHECK
--    clause doing it: the existing row satisfies USING (it is an expense the
--    caller authored), so the statement matches it — what is refused is the
--    RESULT. transactions_kind_shape would also refuse the attempt, but a
--    constraint is not an authorisation rule, and leaning on one is how the
--    UPDATE policy came to be missing this clause in the first place.
-- ===========================================================================
select pg_temp.as_user('e1111111-0000-4000-8000-000000000201');
select pg_temp.rejects(
  $$update ez_finance.transactions
    set    kind = 'transfer'
    where  id = 'e0000000-0000-4000-8000-00000000af01'$$,
  'an expense cannot become a transfer'
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select kind from ez_finance.transactions
   where id = 'e0000000-0000-4000-8000-00000000af01') = 'expense',
  'and the row is untouched by the attempt'
);

-- ===========================================================================
-- 4. "Transacciones propias" holds on the edit path too: an OWNER does not
--    rewrite a member's movement, and an OBSERVER writes nothing at all.
-- ===========================================================================
select pg_temp.as_user('e2222222-0000-4000-8000-000000000202');
update ez_finance.transactions
set    base_amount = 1, note = 'del owner'
where  id = 'e0000000-0000-4000-8000-00000000af01';

select pg_temp.as_postgres();
select pg_temp.check(
  (select base_amount = 31000 and note = 'Corregido'
   from ez_finance.transactions
   where id = 'e0000000-0000-4000-8000-00000000af01'),
  'the owner cannot edit a member''s movement (affects zero rows, raises nothing)'
);

select pg_temp.as_user('e3333333-0000-4000-8000-000000000203');
update ez_finance.transactions
set    base_amount = 2
where  id = 'e0000000-0000-4000-8000-00000000af01';

select pg_temp.as_postgres();
select pg_temp.check(
  (select base_amount from ez_finance.transactions
   where id = 'e0000000-0000-4000-8000-00000000af01') = 31000,
  'nor can an observer'
);

-- ===========================================================================
-- 5. An edit cannot reassign authorship. Refused by the policy, not merely by
--    the adapter leaving created_by out of its payload — and it RAISES, because
--    the row being edited is the caller's (USING passes) while the row it would
--    become is not (WITH CHECK fails).
-- ===========================================================================
select pg_temp.as_user('e1111111-0000-4000-8000-000000000201');
select pg_temp.rejects(
  $$update ez_finance.transactions
    set    created_by = 'e2222222-0000-4000-8000-000000000202'
    where  id = 'e0000000-0000-4000-8000-00000000af01'$$,
  'an edit cannot hand the movement to someone else'
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select created_by from ez_finance.transactions
   where id = 'e0000000-0000-4000-8000-00000000af01')
    = 'e1111111-0000-4000-8000-000000000201',
  'and the author is unchanged'
);

-- ===========================================================================
-- 6. The cross-workspace guard still fires on UPDATE, not only on INSERT.
--    transactions_validate_refs is declared `before insert or update of
--    workspace_id, account_id, counter_account_id, category_id` — this is what
--    proves the update half of that declaration works.
-- ===========================================================================
insert into ez_finance.workspaces (id, name, type)
values ('e0000000-0000-4000-8000-0000000000ee', 'Otra', 'shared');
insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values ('e0000000-0000-4000-8000-0000000000ee', 'e1111111-0000-4000-8000-000000000201', '', 'owner');
insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('e0000000-0000-4000-8000-00000000ae03', 'e0000000-0000-4000-8000-0000000000ee', 'Ajena', 'cash', 'PEN', 0);

select pg_temp.as_user('e1111111-0000-4000-8000-000000000201');
do $$
begin
  begin
    update ez_finance.transactions
    set    account_id = 'e0000000-0000-4000-8000-00000000ae03'
    where  id = 'e0000000-0000-4000-8000-00000000af01';
    raise exception 'FAIL: an edit pointed a movement at another space''s account';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise;
      end if;
      raise notice 'PASS: an edit cannot point a movement at another space''s account (%)', sqlerrm;
  end;
end
$$;

select pg_temp.as_postgres();
do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
