-- Behavioural verification of ez_finance.expense_splits and the receivable account.
--
-- THE CHECK THAT CARRIES THE DESIGN is section 5: a transfer into the "Por cobrar"
-- account must consume NO bucket. That is the whole reason this feature does not touch
-- the budget engine — the engine already treats operational→operational transfers as
-- neutral — and if `receivable` were ever mistaken for a savings type, lending someone
-- money would silently count as having saved it.
--
-- Fixture UUIDs use the 5xxx / d1-d2 range, disjoint from the other suites.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('51111111-0000-4000-8000-000000000501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sowner@test.local',    '', now(), now(), now()),
  ('52222222-0000-4000-8000-000000000502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sobserver@test.local', '', now(), now(), now());

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
-- Fixtures: one shared workspace with an owner and an observer, a cash account,
-- a "Por cobrar" account, a category, and a second workspace for the
-- cross-workspace guard.
-- ---------------------------------------------------------------------------
insert into ez_finance.workspaces (id, name, type)
values
  ('50000000-0000-4000-8000-0000000000d1', 'Casa',  'shared'),
  ('50000000-0000-4000-8000-0000000000d2', 'Otra',  'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('50000000-0000-4000-8000-0000000000d1', '51111111-0000-4000-8000-000000000501', '', 'owner'),
  ('50000000-0000-4000-8000-0000000000d1', '52222222-0000-4000-8000-000000000502', '', 'observer'),
  ('50000000-0000-4000-8000-0000000000d2', '51111111-0000-4000-8000-000000000501', '', 'owner');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values
  ('50000000-0000-4000-8000-00000000ae01', '50000000-0000-4000-8000-0000000000d1', 'Efectivo',   'cash',       'PEN', 100000),
  ('50000000-0000-4000-8000-00000000ae02', '50000000-0000-4000-8000-0000000000d1', 'Por cobrar', 'receivable', 'PEN', 0),
  ('50000000-0000-4000-8000-00000000ae03', '50000000-0000-4000-8000-0000000000d1', 'Ahorro',     'savings',    'PEN', 0),
  ('50000000-0000-4000-8000-00000000ae04', '50000000-0000-4000-8000-0000000000d2', 'Ajena',      'cash',       'PEN', 0);

insert into ez_finance.categories (id, workspace_id, name, bucket)
values ('50000000-0000-4000-8000-00000000ac01', '50000000-0000-4000-8000-0000000000d1', 'Salidas', 'want');

-- ===========================================================================
-- 1. The receivable account type exists and is NOT savings.
-- ===========================================================================
select pg_temp.check(
  (select type from ez_finance.accounts
   where id = '50000000-0000-4000-8000-00000000ae02') = 'receivable',
  'an account can be of type receivable'
);

select pg_temp.rejects(
  $$insert into ez_finance.accounts (workspace_id, name, type, currency, initial_balance)
    values ('50000000-0000-4000-8000-0000000000d1', 'Inventada', 'cobrable', 'PEN', 0)$$,
  'an unrecognised account type is still refused — the CHECK was extended, not dropped'
);

-- ===========================================================================
-- 2. A split hangs off an EXPENSE the workspace owns.
-- ===========================================================================
select pg_temp.as_user('51111111-0000-4000-8000-000000000501');

insert into ez_finance.transactions
  (id, workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
   exchange_rate, occurred_on, category_id, note, created_by)
values
  ('50000000-0000-4000-8000-00000000af01', '50000000-0000-4000-8000-0000000000d1',
   '50000000-0000-4000-8000-00000000ae01', 'expense', 30000, 30000, 'PEN', 1,
   current_date, '50000000-0000-4000-8000-00000000ac01', 'Asado (mi parte)',
   '51111111-0000-4000-8000-000000000501');

insert into ez_finance.expense_splits
  (workspace_id, transaction_id, debtor_name, amount)
values
  ('50000000-0000-4000-8000-0000000000d1',
   '50000000-0000-4000-8000-00000000af01', 'Ana', 30000),
  ('50000000-0000-4000-8000-0000000000d1',
   '50000000-0000-4000-8000-00000000af01', 'Beto', 30000);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits
   where transaction_id = '50000000-0000-4000-8000-00000000af01') = 2,
  'two people can owe for the same expense'
);
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits where settled_at is null) = 2,
  'a new split starts unsettled'
);

-- ===========================================================================
-- 3. Guards on the split itself.
-- ===========================================================================
select pg_temp.as_user('51111111-0000-4000-8000-000000000501');

select pg_temp.rejects(
  $$insert into ez_finance.expense_splits (workspace_id, transaction_id, debtor_name, amount)
    values ('50000000-0000-4000-8000-0000000000d1',
            '50000000-0000-4000-8000-00000000af01', '   ', 1000)$$,
  'a blank debtor name is refused'
);
select pg_temp.rejects(
  $$insert into ez_finance.expense_splits (workspace_id, transaction_id, debtor_name, amount)
    values ('50000000-0000-4000-8000-0000000000d1',
            '50000000-0000-4000-8000-00000000af01', 'Ana', 0)$$,
  'a split of zero is refused — that is not a split'
);

-- The cross-workspace guard: the transaction is one this caller can legitimately see,
-- because they own both spaces, which is exactly why RLS cannot catch it.
select pg_temp.rejects(
  $$insert into ez_finance.expense_splits (workspace_id, transaction_id, debtor_name, amount)
    values ('50000000-0000-4000-8000-0000000000d2',
            '50000000-0000-4000-8000-00000000af01', 'Ana', 1000)$$,
  'a transaction from ANOTHER space cannot be split here'
);

-- A split explains a shared EXPENSE. Attaching one to a transfer would claim someone
-- owes you for money you moved between your own accounts.
select ez_finance.record_transfer(
  '50000000-0000-4000-8000-0000000000d1',
  '50000000-0000-4000-8000-00000000ae01',
  '50000000-0000-4000-8000-00000000ae03',
  10000, 10000, 'PEN', 1, current_date, null
) as tid \gset

select pg_temp.rejects(
  format($$insert into ez_finance.expense_splits (workspace_id, transaction_id, debtor_name, amount)
           select '50000000-0000-4000-8000-0000000000d1', t.id, 'Ana', 1000
           from   ez_finance.transactions t
           where  t.transfer_id = %L and t.transfer_leg = 'out'$$, :'tid'),
  'a TRANSFER leg cannot be split'
);

-- ===========================================================================
-- 4. RLS: a split is a movement, so it follows the transacting roles.
--    An observer reads and writes nothing.
-- ===========================================================================
select pg_temp.as_user('52222222-0000-4000-8000-000000000502');

select pg_temp.check(
  (select count(*) from ez_finance.expense_splits
   where workspace_id = '50000000-0000-4000-8000-0000000000d1') = 2,
  'an observer READS the splits of their space'
);
select pg_temp.rejects(
  $$insert into ez_finance.expense_splits (workspace_id, transaction_id, debtor_name, amount)
    values ('50000000-0000-4000-8000-0000000000d1',
            '50000000-0000-4000-8000-00000000af01', 'Colado', 1000)$$,
  'an observer cannot CREATE one'
);

-- A refused UPDATE raises nothing — it matches zero rows — so this asserts the
-- surviving state.
update ez_finance.expense_splits set settled_at = now()
where  workspace_id = '50000000-0000-4000-8000-0000000000d1';

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits where settled_at is null) = 2,
  'nor mark one settled (silently affects no rows)'
);

-- ===========================================================================
-- 5. THE CHECK THE WHOLE DESIGN RESTS ON.
--
--    A transfer into the receivable account moves real money and must consume NO
--    bucket. The engine reads `accounts.type` and treats only `savings` as the
--    savings sink; `receivable` must therefore behave exactly like cash or bank here.
--
--    Asserted at the DATA level the engine consumes: the account's type, and the
--    balances both sides of the transfer. If a future change made `receivable` a
--    savings-like type, lending money would start counting as saving and this is
--    where it would be caught.
-- ===========================================================================
select pg_temp.as_user('51111111-0000-4000-8000-000000000501');

select ez_finance.record_transfer(
  '50000000-0000-4000-8000-0000000000d1',
  '50000000-0000-4000-8000-00000000ae01',
  '50000000-0000-4000-8000-00000000ae02',
  60000, 60000, 'PEN', 1, current_date, 'Lo que me deben'
) as rid \gset

select pg_temp.as_postgres();

select pg_temp.check(
  (select type from ez_finance.accounts
   where id = '50000000-0000-4000-8000-00000000ae02') <> 'savings',
  'the receivable account is NOT a savings type — lending is not saving'
);

select pg_temp.check(
  (select balance from ez_finance.account_balances('50000000-0000-4000-8000-0000000000d1')
   where account_id = '50000000-0000-4000-8000-00000000ae02') = 60000,
  'the receivable balance IS the total still owed to you'
);

-- 100000 initial - 30000 expense - 10000 to savings - 60000 to receivable = 0
select pg_temp.check(
  (select balance from ez_finance.account_balances('50000000-0000-4000-8000-0000000000d1')
   where account_id = '50000000-0000-4000-8000-00000000ae01') = 0,
  'and the cash account really lost the money — the balance is not a fiction'
);

-- ===========================================================================
-- 6. Getting paid back returns the money, and the debt closes.
-- ===========================================================================
select pg_temp.as_user('51111111-0000-4000-8000-000000000501');

select ez_finance.record_transfer(
  '50000000-0000-4000-8000-0000000000d1',
  '50000000-0000-4000-8000-00000000ae02',
  '50000000-0000-4000-8000-00000000ae01',
  30000, 30000, 'PEN', 1, current_date, 'Ana pagó'
) as pid \gset

update ez_finance.expense_splits
set    settled_at = now()
where  transaction_id = '50000000-0000-4000-8000-00000000af01'
and    debtor_name = 'Ana';

select pg_temp.as_postgres();
select pg_temp.check(
  (select balance from ez_finance.account_balances('50000000-0000-4000-8000-0000000000d1')
   where account_id = '50000000-0000-4000-8000-00000000ae02') = 30000,
  'the receivable balance drops to what is still owed'
);
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits where settled_at is null) = 1,
  'and only Beto is still on the hook'
);

-- ===========================================================================
-- 7. History is protected: the expense cannot be deleted out from under a split.
-- ===========================================================================
select pg_temp.as_user('51111111-0000-4000-8000-000000000501');
select pg_temp.rejects(
  $$delete from ez_finance.transactions
    where id = '50000000-0000-4000-8000-00000000af01'$$,
  'the expense cannot be deleted while a split still explains it'
);

-- ===========================================================================
-- 8. Guards.
-- ===========================================================================
select pg_temp.as_postgres();
select pg_temp.check(
  (select relrowsecurity from pg_class
   where relnamespace = 'ez_finance'::regnamespace and relname = 'expense_splits'),
  'RLS is enabled on expense_splits'
);

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;
select pg_temp.as_anon();
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits) = 0,
  'anon reads no splits despite the schema-wide table grants'
);
select pg_temp.as_postgres();

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
