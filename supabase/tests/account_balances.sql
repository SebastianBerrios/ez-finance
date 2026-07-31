-- Behavioural verification of ez_finance.account_balances().
--
-- This is the ONLY implementation of the sign rule in the codebase — income and
-- transfer-in add, expense and transfer-out subtract — so this file is the only
-- thing standing between a wrong sign and a wrong balance on screen. It lives in
-- SQL because a balance spans the whole history while the dashboard only ever loads
-- one month; see the migration's header.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('ba111111-0000-4000-8000-00000000ba01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bal.owner@test.local', '', now(), now(), now()),
  ('ba222222-0000-4000-8000-00000000ba02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bal.other@test.local', '', now(), now(), now());

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

create or replace function pg_temp.balance_of(p_ws uuid, p_account uuid) returns bigint language sql as $$
  select balance from ez_finance.account_balances(p_ws) where account_id = p_account
$$;

-- ===========================================================================
-- 1. A workspace with an operating account and a savings account.
-- ===========================================================================
insert into ez_finance.workspaces (id, name, type, base_currency)
values
  ('ba110000-0000-4000-8000-00000000bb01', 'Mio',  'shared', 'PEN'),
  ('ba110000-0000-4000-8000-00000000bb02', 'Otro', 'shared', 'PEN');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('ba110000-0000-4000-8000-00000000bb01', 'ba111111-0000-4000-8000-00000000ba01', '', 'owner'),
  ('ba110000-0000-4000-8000-00000000bb02', 'ba222222-0000-4000-8000-00000000ba02', '', 'owner');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values
  ('ba330000-0000-4000-8000-00000000cc01', 'ba110000-0000-4000-8000-00000000bb01', 'Efectivo', 'cash',    'PEN', 100000),
  ('ba330000-0000-4000-8000-00000000cc02', 'ba110000-0000-4000-8000-00000000bb01', 'Ahorro',   'savings', 'PEN', 0),
  ('ba330000-0000-4000-8000-00000000cc03', 'ba110000-0000-4000-8000-00000000bb01', 'Tarjeta',  'card',    'PEN', -50000);

insert into ez_finance.categories (id, workspace_id, name, bucket)
values ('ba440000-0000-4000-8000-00000000dd01', 'ba110000-0000-4000-8000-00000000bb01', 'Comida', 'need');

-- ===========================================================================
-- 2. With no movements, the balance IS the opening balance — including a
--    negative one, which is what a credit card legitimately looks like.
-- ===========================================================================
select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc01') = 100000,
  'no movements: the balance is the opening balance'
);
select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc03') = -50000,
  'a card opens negative and stays negative'
);
select pg_temp.check(
  (select movement_count from ez_finance.account_balances('ba110000-0000-4000-8000-00000000bb01')
   where account_id = 'ba330000-0000-4000-8000-00000000cc01') = 0,
  'movement_count distinguishes "nothing recorded" from "nets to zero"'
);

-- ===========================================================================
-- 3. THE SIGN RULE. Income adds, expense subtracts.
-- ===========================================================================
select pg_temp.as_user('ba111111-0000-4000-8000-00000000ba01');

insert into ez_finance.transactions
  (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
   exchange_rate, occurred_on, created_by)
values ('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc01',
        'income', 350000, 350000, 'PEN', 1, current_date,
        'ba111111-0000-4000-8000-00000000ba01');

select pg_temp.as_postgres();
select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc01') = 450000,
  'income ADDS (100000 + 350000)'
);

select pg_temp.as_user('ba111111-0000-4000-8000-00000000ba01');
insert into ez_finance.transactions
  (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
   exchange_rate, occurred_on, category_id, created_by)
values ('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc01',
        'expense', 25000, 25000, 'PEN', 1, current_date,
        'ba440000-0000-4000-8000-00000000dd01', 'ba111111-0000-4000-8000-00000000ba01');

select pg_temp.as_postgres();
select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc01') = 425000,
  'expense SUBTRACTS (450000 - 25000)'
);

-- ===========================================================================
-- 4. A transfer moves money between two balances and changes NEITHER total.
--    The most likely place for a sign error to hide, because a flipped leg still
--    looks plausible on one side.
-- ===========================================================================
select pg_temp.as_user('ba111111-0000-4000-8000-00000000ba01');
select ez_finance.record_transfer(
  'ba110000-0000-4000-8000-00000000bb01',
  'ba330000-0000-4000-8000-00000000cc01',   -- from Efectivo
  'ba330000-0000-4000-8000-00000000cc02',   -- to Ahorro
  80000, 80000, 'PEN', 1, current_date, 'Al ahorro'
);

select pg_temp.as_postgres();
select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc01') = 345000,
  'the OUT leg subtracts from the source (425000 - 80000)'
);
select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc02') = 80000,
  'the IN leg adds to the destination'
);
select pg_temp.check(
  (select sum(balance) from ez_finance.account_balances('ba110000-0000-4000-8000-00000000bb01'))
    = 100000 + 0 + -50000 + 350000 - 25000,
  'a transfer leaves the WORKSPACE total untouched — it only moves money'
);

-- ===========================================================================
-- 5. Archiving an account does not erase its money.
-- ===========================================================================
update ez_finance.accounts set archived_at = now()
where id = 'ba330000-0000-4000-8000-00000000cc02';

select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc02') = 80000,
  'an archived account keeps its balance — archiving hides it, it does not empty it'
);
select pg_temp.check(
  (select count(*) from ez_finance.account_balances('ba110000-0000-4000-8000-00000000bb01')) = 3,
  'and it is still listed'
);

-- ===========================================================================
-- 6. Every account appears, even one that has never been touched.
--    A LEFT JOIN mistake would silently drop exactly these.
-- ===========================================================================
insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('ba330000-0000-4000-8000-00000000cc04', 'ba110000-0000-4000-8000-00000000bb01', 'Nueva', 'bank', 'PEN', 7);

select pg_temp.check(
  pg_temp.balance_of('ba110000-0000-4000-8000-00000000bb01', 'ba330000-0000-4000-8000-00000000cc04') = 7,
  'an account with zero movements is present, not omitted'
);

-- ===========================================================================
-- 7. SECURITY INVOKER: the function cannot be used to read another workspace.
-- ===========================================================================
select pg_temp.as_user('ba222222-0000-4000-8000-00000000ba02');
select pg_temp.check(
  (select count(*) from ez_finance.account_balances('ba110000-0000-4000-8000-00000000bb01')) = 0,
  'a non-member reads NOTHING through account_balances — INVOKER, not DEFINER'
);

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;
select pg_temp.as_anon();
select pg_temp.check(
  (select count(*) from ez_finance.account_balances('ba110000-0000-4000-8000-00000000bb01')) = 0,
  'nor does anon'
);
select pg_temp.as_postgres();

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
