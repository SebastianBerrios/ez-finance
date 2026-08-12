-- Behavioural verification of ez_finance.record_split_expense and settle_split.
--
-- WHAT THIS SUITE IS FOR. Slice 1 proved the TABLE behaves; these two functions are the
-- only writers of it in the app, and each one performs three writes that must all land
-- or none. The checks that carry the design:
--
--   §2 the three writes agree — the expense is YOUR share, the receivable is THEIR
--      total, and the account really lost the sum of both;
--   §4 a share of ZERO still records who owes you. That case has no expense row to hang
--      the splits off, and before 20260812160000 they were silently not written at all:
--      a "Por cobrar" balance with no breakdown, invisible in the list and impossible to
--      collect. It is the reason this migration replaces the slice-1 trigger;
--   §6 settling twice is refused, so two taps cannot both move the money.
--
-- Fixture UUIDs use the 6xxx / e1-e2 range, disjoint from the other suites.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('61111111-0000-4000-8000-000000000601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rowner@test.local',    '', now(), now(), now()),
  ('62222222-0000-4000-8000-000000000602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'robserver@test.local', '', now(), now(), now()),
  ('63333333-0000-4000-8000-000000000603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rstranger@test.local', '', now(), now(), now());

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
-- Fixtures. NO receivable account is created: the first split has to conjure it,
-- which is §1. base_currency is set on the workspace the way the accounts trigger
-- would have set it, since the RPC reads it from there.
-- ---------------------------------------------------------------------------
insert into ez_finance.workspaces (id, name, type, base_currency)
values
  ('60000000-0000-4000-8000-0000000000e1', 'Casa',    'shared', 'PEN'),
  -- No base currency and no accounts: nothing to split from.
  ('60000000-0000-4000-8000-0000000000e2', 'Reciente', 'shared', null);

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('60000000-0000-4000-8000-0000000000e1', '61111111-0000-4000-8000-000000000601', '', 'owner'),
  ('60000000-0000-4000-8000-0000000000e1', '62222222-0000-4000-8000-000000000602', '', 'observer'),
  ('60000000-0000-4000-8000-0000000000e2', '61111111-0000-4000-8000-000000000601', '', 'owner');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values
  ('60000000-0000-4000-8000-00000000be01', '60000000-0000-4000-8000-0000000000e1', 'Efectivo', 'cash', 'PEN', 200000),
  ('60000000-0000-4000-8000-00000000be02', '60000000-0000-4000-8000-0000000000e1', 'Banco',    'bank', 'PEN', 0);

insert into ez_finance.categories (id, workspace_id, name, bucket)
values ('60000000-0000-4000-8000-00000000bc01', '60000000-0000-4000-8000-0000000000e1', 'Salidas', 'want');

-- ===========================================================================
-- 1. The "Por cobrar" account is created ON DEMAND, exactly once.
-- ===========================================================================
select pg_temp.as_user('61111111-0000-4000-8000-000000000601');

select pg_temp.check(
  (select count(*) from ez_finance.accounts
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and type = 'receivable') = 0,
  'the workspace starts with no receivable account'
);

select ez_finance.record_split_expense(
  '60000000-0000-4000-8000-0000000000e1',
  '60000000-0000-4000-8000-00000000be01',
  '60000000-0000-4000-8000-00000000bc01',
  30000, current_date, 'Asado',
  '[{"name": "Ana", "amount": "30000"}, {"name": "Beto", "amount": "30000"}]'::jsonb
) as first_expense \gset

select pg_temp.check(
  (select count(*) from ez_finance.accounts
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and type = 'receivable') = 1,
  'the first split creates it'
);
select pg_temp.check(
  (select name from ez_finance.accounts
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and type = 'receivable') = 'Por cobrar',
  'and it is called Por cobrar, in the workspace base currency'
);
select pg_temp.check(
  (select currency from ez_finance.accounts
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and type = 'receivable') = 'PEN',
  'the currency comes from the workspace, not from a guess'
);

-- A SECOND split must reuse it. Two receivable accounts would split the total owed in
-- two and answer "how much do they owe me" wrong.
select ez_finance.record_split_expense(
  '60000000-0000-4000-8000-0000000000e1',
  '60000000-0000-4000-8000-00000000be01',
  null,
  10000, current_date, 'Taxi',
  '[{"name": "Ana", "amount": "10000"}]'::jsonb
) as second_expense \gset

select pg_temp.check(
  (select count(*) from ez_finance.accounts
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and type = 'receivable') = 1,
  'a second split REUSES it — one receivable account per workspace'
);

-- ===========================================================================
-- 2. THE THREE WRITES AGREE.
--
--    First split: my share 300, Ana 300, Beto 300 → I paid 900.
--    Second split: my share 100, Ana 100 → I paid 200.
--    So: expenses 400, receivable 700, cash 2000 - 1100 = 900.
-- ===========================================================================
select pg_temp.as_postgres();

select pg_temp.check(
  (select base_amount from ez_finance.transactions where id = :'first_expense') = 30000,
  'the expense row is YOUR share only — not the total paid'
);
select pg_temp.check(
  (select category_id from ez_finance.transactions where id = :'first_expense')
    = '60000000-0000-4000-8000-00000000bc01',
  'and it carries the category, because only your share reaches a bucket'
);
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits
   where transaction_id = :'first_expense') = 2,
  'both debtors are recorded against it'
);
select pg_temp.check(
  (select sum(amount) from ez_finance.expense_splits
   where transaction_id = :'first_expense') = 60000,
  'and their amounts are the ones passed in'
);

select pg_temp.check(
  (select balance from ez_finance.account_balances('60000000-0000-4000-8000-0000000000e1')
   where account_id = (select id from ez_finance.accounts
                       where workspace_id = '60000000-0000-4000-8000-0000000000e1'
                       and   type = 'receivable')) = 70000,
  'the receivable balance is the total owed across both splits'
);
select pg_temp.check(
  (select balance from ez_finance.account_balances('60000000-0000-4000-8000-0000000000e1')
   where account_id = '60000000-0000-4000-8000-00000000be01') = 90000,
  'and the cash account lost share + owed, not one or the other'
);

-- The transfer legs are NEUTRAL for the budget by construction: the destination is not
-- a savings account, which is the only type the engine feeds the savings bucket from.
select pg_temp.check(
  (select type from ez_finance.accounts
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and type = 'receivable') <> 'savings',
  'the receivable account is not savings — lending is not saving'
);

-- ===========================================================================
-- 3. Nothing is written when anything is wrong. Each of these is ATOMIC: the
--    expense must not survive a refused debtor list.
-- ===========================================================================
select pg_temp.as_user('61111111-0000-4000-8000-000000000601');

select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, -100, current_date, null, '[{"name": "Ana", "amount": "1000"}]'::jsonb)$$,
  'a NEGATIVE share is refused'
);
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null, '[]'::jsonb)$$,
  'an EMPTY debtor list is refused — that is an ordinary expense'
);
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null, null)$$,
  'a NULL debtor list is refused'
);
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null, '[{"name": "  ", "amount": "1000"}]'::jsonb)$$,
  'a BLANK debtor name is refused'
);
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null, '[{"name": "Ana", "amount": "0"}]'::jsonb)$$,
  'a debtor who owes ZERO is refused'
);
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null,
      '[{"name": "Ana", "amount": "1000"}, {"name": "Beto"}]'::jsonb)$$,
  'a debtor with NO amount is refused — and the first one is not written either'
);

-- A workspace with no base currency has no accounts, so there is nothing to split from.
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e2', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null, '[{"name": "Ana", "amount": "1000"}]'::jsonb)$$,
  'a workspace with no base currency reports it instead of guessing one'
);

select pg_temp.as_postgres();
-- 2 + 1 from the successful calls. Every refusal above left NOTHING behind.
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits
   where workspace_id = '60000000-0000-4000-8000-0000000000e1') = 3,
  'ALL of those refusals were atomic — no orphan expense, no orphan split'
);
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and kind = 'expense') = 2,
  'and no expense row survived a refused debtor list'
);

-- ===========================================================================
-- 4. A SHARE OF ZERO. You paid for someone else in full.
--
--    THE CHECK THIS MIGRATION EXISTS FOR. There is no expense of yours, so there was
--    nothing for the splits to point at and they were quietly not written: the money
--    moved into "Por cobrar" and no row said who owed it. The split now hangs off the
--    leg that landed on the receivable account.
-- ===========================================================================
select pg_temp.as_user('61111111-0000-4000-8000-000000000601');

select pg_temp.check(
  ez_finance.record_split_expense(
    '60000000-0000-4000-8000-0000000000e1',
    '60000000-0000-4000-8000-00000000be01',
    null, 0, current_date, 'Remedios de mamá',
    '[{"name": "Mamá", "amount": "50000"}]'::jsonb
  ) is null,
  'a share of zero writes NO expense row, and says so by returning null'
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits
   where debtor_name = 'Mamá' and amount = 50000) = 1,
  'but the DEBT IS RECORDED — this is the bug 20260812160000 fixes'
);
select pg_temp.check(
  (select t.kind from ez_finance.expense_splits s
   join ez_finance.transactions t on t.id = s.transaction_id
   where s.debtor_name = 'Mamá') = 'transfer',
  'it hangs off the transfer leg, since there is no expense of yours'
);
select pg_temp.check(
  (select a.type from ez_finance.expense_splits s
   join ez_finance.transactions t on t.id = s.transaction_id
   join ez_finance.accounts a on a.id = t.account_id
   where s.debtor_name = 'Mamá') = 'receivable',
  'and specifically off the leg that LANDED on Por cobrar'
);
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where workspace_id = '60000000-0000-4000-8000-0000000000e1' and kind = 'expense') = 2,
  'no expense of zero was invented to hang it off'
);

-- Every other transfer is STILL refused, which is what slice 1 pinned. A leg landing on
-- a savings account is the case the original trigger was written for.
insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('60000000-0000-4000-8000-00000000be03', '60000000-0000-4000-8000-0000000000e1', 'Ahorro', 'savings', 'PEN', 0);

select pg_temp.as_user('61111111-0000-4000-8000-000000000601');
select ez_finance.record_transfer(
  '60000000-0000-4000-8000-0000000000e1',
  '60000000-0000-4000-8000-00000000be01',
  '60000000-0000-4000-8000-00000000be03',
  1000, 1000, 'PEN', 1, current_date, null
) as savings_transfer \gset

select pg_temp.rejects(
  format($$insert into ez_finance.expense_splits (workspace_id, transaction_id, debtor_name, amount)
           select '60000000-0000-4000-8000-0000000000e1', t.id, 'Colado', 1000
           from   ez_finance.transactions t
           where  t.transfer_id = %L and t.transfer_leg = 'in'$$, :'savings_transfer'),
  'a transfer leg landing anywhere ELSE still cannot be split'
);

-- ===========================================================================
-- 5. Who may record one. The transacting roles, and nobody else.
-- ===========================================================================
select pg_temp.as_user('62222222-0000-4000-8000-000000000602');
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null, '[{"name": "Ana", "amount": "1000"}]'::jsonb)$$,
  'an OBSERVER cannot record a split expense'
);

select pg_temp.as_user('63333333-0000-4000-8000-000000000603');
select pg_temp.rejects(
  $$select ez_finance.record_split_expense(
      '60000000-0000-4000-8000-0000000000e1', '60000000-0000-4000-8000-00000000be01',
      null, 1000, current_date, null, '[{"name": "Ana", "amount": "1000"}]'::jsonb)$$,
  'and an authenticated NON-MEMBER cannot either — authentication is not membership'
);

-- ===========================================================================
-- 6. Settling. The money comes back into an account YOU choose, once.
-- ===========================================================================
select pg_temp.as_postgres();
select id from ez_finance.expense_splits
where  debtor_name = 'Ana' and amount = 30000 limit 1 \gset ana_

select pg_temp.as_user('61111111-0000-4000-8000-000000000601');

-- Into the BANK account, not the cash one the expense came from: someone can pay you
-- back in a way that does not match how you paid.
select ez_finance.settle_split(
  :'ana_id', '60000000-0000-4000-8000-00000000be02', current_date
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select settled_at is not null from ez_finance.expense_splits where id = :'ana_id'),
  'the split is stamped settled'
);
select pg_temp.check(
  (select balance from ez_finance.account_balances('60000000-0000-4000-8000-0000000000e1')
   where account_id = '60000000-0000-4000-8000-00000000be02') = 30000,
  'the money landed in the account chosen, not the one that paid'
);
select pg_temp.check(
  (select balance from ez_finance.account_balances('60000000-0000-4000-8000-0000000000e1')
   where account_id = (select id from ez_finance.accounts
                       where workspace_id = '60000000-0000-4000-8000-0000000000e1'
                       and   type = 'receivable')) = 90000,
  'and the receivable balance drops to what is still owed (700 + 500 - 300)'
);
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where workspace_id = '60000000-0000-4000-8000-0000000000e1'
   and   note = 'Cobro de Ana') = 2,
  'the repayment is a transfer whose note names who paid'
);

-- The check that makes two taps safe.
select pg_temp.as_user('61111111-0000-4000-8000-000000000601');
select pg_temp.rejects(
  format($$select ez_finance.settle_split(%L, '60000000-0000-4000-8000-00000000be02', current_date)$$, :'ana_id'),
  'settling the SAME split twice is refused — two taps cannot both move the money'
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select balance from ez_finance.account_balances('60000000-0000-4000-8000-0000000000e1')
   where account_id = '60000000-0000-4000-8000-00000000be02') = 30000,
  'and the refused second attempt moved nothing'
);

-- ===========================================================================
-- 7. Settling something that is not yours.
-- ===========================================================================
select pg_temp.as_postgres();
select id from ez_finance.expense_splits
where  debtor_name = 'Beto' limit 1 \gset beto_

select pg_temp.as_user('62222222-0000-4000-8000-000000000602');
select pg_temp.rejects(
  format($$select ez_finance.settle_split(%L, '60000000-0000-4000-8000-00000000be02', current_date)$$, :'beto_id'),
  'an OBSERVER cannot settle'
);

select pg_temp.as_user('63333333-0000-4000-8000-000000000603');
select pg_temp.rejects(
  format($$select ez_finance.settle_split(%L, '60000000-0000-4000-8000-00000000be02', current_date)$$, :'beto_id'),
  'a NON-MEMBER cannot settle'
);
-- An id that names nothing gets the SAME answer as one that is not yours, so ids
-- cannot be probed by comparing the two errors.
select pg_temp.rejects(
  $$select ez_finance.settle_split(
      '60000000-0000-4000-8000-00000000dead', '60000000-0000-4000-8000-00000000be02', current_date)$$,
  'and an id that names nothing is refused the same way'
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select settled_at is null from ez_finance.expense_splits where id = :'beto_id'),
  'Beto still owes — every refusal above left the row alone'
);

-- ===========================================================================
-- 8. The private helper stays private.
-- ===========================================================================
select pg_temp.check(
  not has_function_privilege('authenticated', 'ez_finance_private.receivable_account(uuid)', 'execute'),
  'authenticated cannot call the receivable_account helper directly'
);
select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.record_split_expense(uuid, uuid, uuid, bigint, date, text, jsonb)', 'execute'),
  'anon cannot call record_split_expense'
);
select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.settle_split(uuid, uuid, date)', 'execute'),
  'anon cannot call settle_split'
);

-- ===========================================================================
-- 9. DELETING THE WHOLE SPACE STILL WORKS, with splits in it.
--
--    WHY THIS IS HERE AND NOT OBVIOUS. expense_splits.transaction_id is ON DELETE
--    RESTRICT, and deleting a workspace cascades to BOTH transactions and splits.
--    RESTRICT is the immediate variant, so the question is whether the check on the
--    splits fires before the cascade that removes them — if it did, a person who had
--    ever split an expense could not delete their space, and process_deletion_if_due()
--    could not delete their account either.
--
--    It works, because Postgres queues referential actions as after-statement events and
--    drains them FIFO: the sibling cascades all run before any check they queued. That
--    is a guarantee worth PINNING rather than rediscovering, since nothing else in the
--    suite exercises a cascade with a split in it, and account_deletion.sql deletes
--    personal workspaces that hold no movements at all.
--
--    Last, because it destroys the fixtures everything above needs.
-- ===========================================================================
select pg_temp.as_user('61111111-0000-4000-8000-000000000601');

-- Half one: a DELIBERATE delete is still refused. This is the protection RESTRICT was
-- chosen for, and it must survive whatever the cascade does.
select pg_temp.rejects(
  format($$delete from ez_finance.transactions where id = %L$$, :'first_expense'),
  'the expense cannot be deleted while a split still explains it'
);

select pg_temp.as_postgres();

-- Half two: the cascade goes through, splits and all.
delete from ez_finance.workspaces where id = '60000000-0000-4000-8000-0000000000e1';

select pg_temp.check(
  not exists (select 1 from ez_finance.workspaces
              where id = '60000000-0000-4000-8000-0000000000e1'),
  'a space holding accounts, movements and splits CAN be deleted'
);
select pg_temp.check(
  (select count(*) from ez_finance.expense_splits
   where workspace_id = '60000000-0000-4000-8000-0000000000e1') = 0,
  'and its splits went with it'
);

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
