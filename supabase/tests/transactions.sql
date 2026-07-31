-- Behavioural verification of ez_finance.transactions, its tied transfer pair,
-- and workspaces.base_currency.
--
-- Everything load-bearing here is a trigger, a table CHECK, an RLS policy or a
-- SECURITY DEFINER RPC — none of which `supabase db reset` executes. What gets
-- exercised: the base-currency adoption and immutability, the kind/shape rules,
-- same-workspace referential checks, the "own transactions" write rule with an
-- observer who may only read, and that a transfer can only exist as a PAIR.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1111111-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner2@test.local',    '', now(), now(), now()),
  ('a2222222-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member2@test.local',   '', now(), now(), now()),
  ('a3333333-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'observer2@test.local', '', now(), now(), now());

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
-- 1. A workspace with owner, member and observer.
-- ===========================================================================
insert into ez_finance.workspaces (id, name, type)
values ('d0000000-0000-4000-8000-00000000000d', 'Hogar', 'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('d0000000-0000-4000-8000-00000000000d', 'a1111111-0000-4000-8000-000000000001', '', 'owner'),
  ('d0000000-0000-4000-8000-00000000000d', 'a2222222-0000-4000-8000-000000000002', '', 'member'),
  ('d0000000-0000-4000-8000-00000000000d', 'a3333333-0000-4000-8000-000000000003', '', 'observer');

select pg_temp.check(
  (select base_currency is null from ez_finance.workspaces
   where id = 'd0000000-0000-4000-8000-00000000000d'),
  'a fresh workspace has NO base currency — nothing was guessed'
);

-- ===========================================================================
-- 2. A transaction is impossible before a base currency exists.
--    Proven BEFORE creating any account, which is the only ordering in which
--    this is reachable at all.
-- ===========================================================================
select pg_temp.rejects(
  $$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on)
    values ('d0000000-0000-4000-8000-00000000000d', gen_random_uuid(), 'expense',
            100, 100, 'ARS', 1, current_date)$$,
  'no transaction before the workspace has a base currency'
);

-- ===========================================================================
-- 3. The FIRST account sets the base currency; later ones do not change it.
-- ===========================================================================
insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('b0000000-0000-4000-8000-00000000ab01', 'd0000000-0000-4000-8000-00000000000d', 'Efectivo', 'cash', 'ARS', 500000);

select pg_temp.check(
  (select base_currency from ez_finance.workspaces
   where id = 'd0000000-0000-4000-8000-00000000000d') = 'ARS',
  'the first account adopts the workspace base currency'
);

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('b0000000-0000-4000-8000-00000000ab02', 'd0000000-0000-4000-8000-00000000000d', 'Dolares', 'bank', 'USD', 0);

select pg_temp.check(
  (select base_currency from ez_finance.workspaces
   where id = 'd0000000-0000-4000-8000-00000000000d') = 'ARS',
  'a second account in another currency does NOT move the base'
);

-- A savings account, needed by the transfer-to-savings case the engine treats
-- specially.
insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('b0000000-0000-4000-8000-00000000ab03', 'd0000000-0000-4000-8000-00000000000d', 'Ahorro', 'savings', 'ARS', 0);

select pg_temp.rejects(
  $$update ez_finance.workspaces set base_currency = 'USD'
    where id = 'd0000000-0000-4000-8000-00000000000d'$$,
  'base currency is immutable once set'
);

-- ===========================================================================
-- 4. Income / expense shape.
-- ===========================================================================
insert into ez_finance.categories (id, workspace_id, name, bucket)
values ('c0000000-0000-4000-8000-00000000ac01', 'd0000000-0000-4000-8000-00000000000d', 'Supermercado', 'need');

select pg_temp.as_user('a2222222-0000-4000-8000-000000000002');
insert into ez_finance.transactions
  (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
   exchange_rate, occurred_on, category_id, created_by)
values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000ab01', 'expense',
        25000, 25000, 'ARS', 1, current_date, 'c0000000-0000-4000-8000-00000000ac01',
        'a2222222-0000-4000-8000-000000000002');
select pg_temp.check(true, 'a member records an expense in their own name');

select pg_temp.as_postgres();
select pg_temp.rejects(
  $$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on)
    values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000ab01',
            'expense', -500, 500, 'ARS', 1, current_date)$$,
  'a negative base_amount is refused — sign comes from kind, not the number'
);

select pg_temp.rejects(
  $$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on, transfer_leg)
    values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000ab01',
            'expense', 500, 500, 'ARS', 1, current_date, 'out')$$,
  'an expense carrying transfer columns is refused'
);

-- ===========================================================================
-- 5. Same-workspace referential rules the FKs cannot express.
-- ===========================================================================
insert into ez_finance.workspaces (id, name, type, base_currency)
values ('e0000000-0000-4000-8000-00000000000e', 'Ajeno', 'shared', 'ARS');
insert into ez_finance.accounts (id, workspace_id, name, type, currency)
values ('b0000000-0000-4000-8000-00000000ab99', 'e0000000-0000-4000-8000-00000000000e', 'Otra', 'cash', 'ARS');

select pg_temp.rejects(
  $$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on)
    values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000ab99',
            'expense', 500, 500, 'ARS', 1, current_date)$$,
  'an account from another workspace is refused'
);

select pg_temp.rejects(
  $$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on, category_id)
    values ('e0000000-0000-4000-8000-00000000000e', 'b0000000-0000-4000-8000-00000000ab99',
            'expense', 500, 500, 'ARS', 1, current_date, 'c0000000-0000-4000-8000-00000000ac01')$$,
  'a category from another workspace is refused'
);

-- ===========================================================================
-- 6. Transfers exist only as a pair.
-- ===========================================================================
select pg_temp.as_user('a2222222-0000-4000-8000-000000000002');
select pg_temp.rejects(
  $$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on, transfer_id, transfer_leg, counter_account_id, created_by)
    values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000ab01',
            'transfer', 1000, 1000, 'ARS', 1, current_date, gen_random_uuid(), 'out',
            'b0000000-0000-4000-8000-00000000ab03', 'a2222222-0000-4000-8000-000000000002')$$,
  'a lone transfer leg canNOT be inserted directly — RLS refuses kind=transfer'
);

select ez_finance.record_transfer(
  'd0000000-0000-4000-8000-00000000000d',
  'b0000000-0000-4000-8000-00000000ab01',
  'b0000000-0000-4000-8000-00000000ab03',
  40000, 40000, 'ARS', 1, current_date, 'Al ahorro'
) as tid \gset

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.transactions where transfer_id = :'tid') = 2,
  'record_transfer writes exactly two legs'
);
select pg_temp.check(
  (select count(distinct transfer_leg) from ez_finance.transactions where transfer_id = :'tid') = 2,
  'one out leg and one in leg'
);
select pg_temp.check(
  (select count(*) from ez_finance.transactions
   where transfer_id = :'tid' and category_id is not null) = 0,
  'neither leg carries a category — the engine expects none'
);
select pg_temp.check(
  (select bool_and(t.counter_account_id <> t.account_id)
   from ez_finance.transactions t where t.transfer_id = :'tid'),
  'each leg names the OTHER account'
);

select pg_temp.rejects(
  format($$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on, transfer_id, transfer_leg, counter_account_id)
    values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000ab02',
            'transfer', 1, 1, 'ARS', 1, current_date, %L, 'out',
            'b0000000-0000-4000-8000-00000000ab01')$$, :'tid'),
  'a THIRD leg cannot be appended to an existing pair'
);

select pg_temp.rejects(
  $$select ez_finance.record_transfer(
      'd0000000-0000-4000-8000-00000000000d',
      'b0000000-0000-4000-8000-00000000ab01',
      'b0000000-0000-4000-8000-00000000ab01',
      100, 100, 'ARS', 1, current_date)$$,
  'a transfer to the same account is refused'
);

-- ===========================================================================
-- 7. Spec §4: an observer reads but never writes.
-- ===========================================================================
select pg_temp.as_user('a3333333-0000-4000-8000-000000000003');
select pg_temp.check(
  (select count(*) from ez_finance.transactions) = 3,
  'an observer SEES the workspace transactions (1 expense + 2 transfer legs)'
);
select pg_temp.rejects(
  $$insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on, created_by)
    values ('d0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000ab01',
            'income', 100, 100, 'ARS', 1, current_date, 'a3333333-0000-4000-8000-000000000003')$$,
  'an observer canNOT record a transaction'
);
select pg_temp.rejects(
  $$select ez_finance.record_transfer(
      'd0000000-0000-4000-8000-00000000000d',
      'b0000000-0000-4000-8000-00000000ab01',
      'b0000000-0000-4000-8000-00000000ab03',
      100, 100, 'ARS', 1, current_date)$$,
  'nor through record_transfer — the definer re-checks instead of trusting its caller'
);

-- ===========================================================================
-- 8. "Transacciones propias" is literal: not even the owner edits someone
--    else's movement. Remember a denied UPDATE/DELETE does not raise — it
--    affects zero rows — so these assert on the surviving state.
-- ===========================================================================
select pg_temp.as_user('a1111111-0000-4000-8000-000000000001');
update ez_finance.transactions set base_amount = 1
where kind = 'expense';
delete from ez_finance.transactions where kind = 'expense';

select pg_temp.as_postgres();
select pg_temp.check(
  (select base_amount from ez_finance.transactions where kind = 'expense') = 25000,
  'the owner cannot edit a member''s transaction (silently affects no rows)'
);
select pg_temp.check(
  (select count(*) from ez_finance.transactions where kind = 'expense') = 1,
  'nor delete it'
);

-- ===========================================================================
-- 9. delete_transfer removes both legs, and only the caller's own.
-- ===========================================================================
select pg_temp.as_user('a1111111-0000-4000-8000-000000000001');
select pg_temp.check(
  ez_finance.delete_transfer(:'tid') = 0,
  'delete_transfer touches nothing when the pair belongs to someone else'
);

select pg_temp.as_user('a2222222-0000-4000-8000-000000000002');
select pg_temp.check(
  ez_finance.delete_transfer(:'tid') = 2,
  'the author deletes BOTH legs in one call'
);

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.transactions where transfer_id = :'tid') = 0,
  'no half-pair survives'
);

-- ===========================================================================
-- 10. An account carrying movements cannot be deleted out from under them.
-- ===========================================================================
select pg_temp.rejects(
  $$delete from ez_finance.accounts where id = 'b0000000-0000-4000-8000-00000000ab01'$$,
  'deleting an account with transactions is refused — archive it instead'
);

-- ===========================================================================
-- 11. Guards.
-- ===========================================================================
select pg_temp.check(
  (select relrowsecurity from pg_class
   where relnamespace = 'ez_finance'::regnamespace and relname = 'transactions'),
  'RLS is enabled on transactions'
);

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;
select pg_temp.as_anon();
select pg_temp.check(
  (select count(*) from ez_finance.transactions) = 0,
  'anon reads no transactions despite the schema-wide table grants'
);
select pg_temp.as_postgres();

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
