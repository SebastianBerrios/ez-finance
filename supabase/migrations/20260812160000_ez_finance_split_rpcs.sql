-- =============================================================================
-- Recording and settling a split expense, atomically.
--
-- WHY THESE ARE RPCs AND NOT THREE CALLS FROM THE APP. One split expense is three
-- writes that must all land or none: the expense for your share, the transfer of the
-- rest into "Por cobrar", and the rows saying who owes it. Two of the three leave
-- money moved. A client that managed them separately would, on any failure between
-- them, leave a workspace where 900 left an account and nothing explains 600 of it —
-- and the person would have no way to tell.
--
-- This is the same reasoning record_transfer already follows for the two legs of a
-- transfer: a multi-row invariant belongs in one statement, not in a caller's good
-- intentions.
--
-- SECURITY DEFINER, and they re-check membership themselves. The transacting roles
-- (owner, admin, member) may record a shared expense — the same set that may record
-- any movement — and reading that from ez_finance_private means an ARCHIVED workspace
-- refuses these too, for free.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. A split may also hang off the RECEIVABLE LEG of a transfer.
--
-- WHY THIS EXISTS, and it is a hole in 20260809230000 that only the flow exposed.
-- `expense_splits.transaction_id` is NOT NULL and the trigger accepted expenses only,
-- so a split where YOUR share is zero — you paid for someone else in full, which the
-- model deliberately allows — had nothing to point at. The money would move into "Por
-- cobrar" and no row would say who owed it: a balance with no breakdown, invisible in
-- the list and impossible to settle.
--
-- The narrow exception is the honest one. The slice-1 reasoning was that "attaching a
-- split to a transfer would claim someone owes you for money you moved between your own
-- accounts" — true of a transfer to savings, and NOT true of the leg landing on "Por
-- cobrar", which is precisely the debt. So that one leg is admitted and every other
-- transfer stays refused, which is what expense_splits.sql §3 pins.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.expense_splits_validate_refs()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_kind         text;
  v_leg          text;
  v_account_type text;
begin
  select t.kind, t.transfer_leg, a.type
  into   v_kind, v_leg, v_account_type
  from   ez_finance.transactions t
  join   ez_finance.accounts a on a.id = t.account_id
  where  t.id = new.transaction_id
  and    t.workspace_id = new.workspace_id;

  if v_kind is null then
    raise exception 'transaction_not_in_workspace' using errcode = '23514';
  end if;

  if v_kind = 'expense' then
    return new;
  end if;

  if v_kind = 'transfer' and v_leg = 'in' and v_account_type = 'receivable' then
    return new;
  end if;

  raise exception 'split_requires_expense' using errcode = '23514';
end;
$$;

-- ---------------------------------------------------------------------------
-- The workspace's "Por cobrar" account, created the first time it is needed.
--
-- ONE PER WORKSPACE. It is not a place you keep money: its balance IS the total other
-- people owe you, so a second one would split that total in two and answer the
-- question wrong. It is also why the account form does not offer this type — the
-- account is a consequence of splitting an expense, not something you set up.
--
-- The currency comes from the WORKSPACE's base currency, never guessed: every other
-- account already agrees with it, and record_transfer would refuse legs that did not.
-- A workspace with no base currency has no accounts at all, so there is nothing to
-- split from — that is reported rather than papered over.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.receivable_account(p_workspace_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_id       uuid;
  v_currency char(3);
begin
  select a.id
  into   v_id
  from   ez_finance.accounts a
  where  a.workspace_id = p_workspace_id
  and    a.type = 'receivable'
  order  by a.created_at
  limit  1;

  if v_id is not null then
    return v_id;
  end if;

  select w.base_currency
  into   v_currency
  from   ez_finance.workspaces w
  where  w.id = p_workspace_id;

  if v_currency is null then
    raise exception 'workspace_not_ready' using errcode = 'P0001';
  end if;

  insert into ez_finance.accounts (workspace_id, name, type, currency, initial_balance)
  values (p_workspace_id, 'Por cobrar', 'receivable', v_currency, 0)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_split_expense — one shared expense, in one transaction.
--
-- p_my_share is what YOU consumed and is the only part that reaches a bucket.
-- p_debtors is [{"name": "Ana", "amount": 30000}, ...] in minor units; their sum is
-- what moves into "Por cobrar". The total you actually paid is the sum of both, and
-- it is never passed in: deriving it here is what makes the three writes agree by
-- construction instead of by the caller adding correctly.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.record_split_expense(
  p_workspace_id uuid,
  p_account_id   uuid,
  p_category_id  uuid,
  p_my_share     bigint,
  p_occurred_on  date,
  p_note         text,
  p_debtors      jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_currency    char(3);
  v_expense_id  uuid;
  v_receivable  uuid;
  v_transfer_id uuid;
  v_anchor_id   uuid;
  v_owed        bigint;
  v_debtor      jsonb;
  v_count       int;
begin
  if v_uid is null then
    raise exception 'session_not_found' using errcode = '42501';
  end if;

  if p_workspace_id not in (
    select ez_finance_private.transacting_workspace_ids_for_current_user()
  ) then
    raise exception 'not_permitted' using errcode = '42501';
  end if;

  -- YOUR share may be zero: someone else's dinner you paid for and are owed in full
  -- is a real thing, and refusing it would force a fake expense. Negative is not.
  if p_my_share < 0 then
    raise exception 'invalid_share' using errcode = '22023';
  end if;

  if p_debtors is null or pg_catalog.jsonb_typeof(p_debtors) <> 'array' then
    raise exception 'debtors_required' using errcode = '22023';
  end if;

  select pg_catalog.count(*), pg_catalog.coalesce(pg_catalog.sum((d ->> 'amount')::bigint), 0)
  into   v_count, v_owed
  from   pg_catalog.jsonb_array_elements(p_debtors) d;

  if v_count = 0 then
    raise exception 'debtors_required' using errcode = '22023';
  end if;

  -- Checked BEFORE anything is written. Every debtor must be a real name and a real
  -- amount, or the expense lands and the explanation does not.
  for v_debtor in select d from pg_catalog.jsonb_array_elements(p_debtors) d loop
    if pg_catalog.btrim(pg_catalog.coalesce(v_debtor ->> 'name', '')) = '' then
      raise exception 'debtor_name_required' using errcode = '22023';
    end if;
    if (v_debtor ->> 'amount') is null or (v_debtor ->> 'amount')::bigint <= 0 then
      raise exception 'invalid_debtor_amount' using errcode = '22023';
    end if;
  end loop;

  -- Nothing owed is not a split; it is an ordinary expense, and the app has a screen
  -- for that. Refusing keeps "a split always has a receivable side" true.
  if v_owed <= 0 then
    raise exception 'nothing_owed' using errcode = '22023';
  end if;

  select w.base_currency into v_currency
  from   ez_finance.workspaces w where w.id = p_workspace_id;

  if v_currency is null then
    raise exception 'workspace_not_ready' using errcode = 'P0001';
  end if;

  -- 1. Your share, as an ordinary expense. This is the only row a bucket ever sees.
  --    Skipped entirely when it is zero: an expense of 0 violates the amount CHECK,
  --    and a row that says you spent nothing is noise in every list and report.
  if p_my_share > 0 then
    insert into ez_finance.transactions
      (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
       exchange_rate, occurred_on, category_id, note, created_by)
    values
      (p_workspace_id, p_account_id, 'expense', p_my_share, p_my_share, v_currency, 1,
       p_occurred_on, p_category_id, p_note, v_uid)
    returning id into v_expense_id;
  end if;

  -- 2. What the others owe, moved into "Por cobrar". The money really left the
  --    account, so the balance stays honest; the transfer is neutral for the budget
  --    because the engine treats operational→operational as consuming no bucket.
  v_receivable := ez_finance_private.receivable_account(p_workspace_id);

  v_transfer_id := ez_finance.record_transfer(
    p_workspace_id, p_account_id, v_receivable,
    v_owed, v_owed, v_currency, 1, p_occurred_on, p_note
  );

  -- 3. Who owes what. ALWAYS written, and this is the part the schema made subtle.
  --
  --    It hangs off the expense when there is one, because that is the shared thing
  --    being explained. When your share was zero there IS no expense of yours, so it
  --    hangs off the leg that landed on "Por cobrar" — the row that moved the money
  --    being owed. Section 0 above admits exactly that leg.
  --
  --    NEVER conditional on the expense existing: a receivable with no breakdown is a
  --    debt nobody can see or collect, which is the bug this replaces.
  if v_expense_id is not null then
    v_anchor_id := v_expense_id;
  else
    select t.id
    into   v_anchor_id
    from   ez_finance.transactions t
    where  t.transfer_id = v_transfer_id
    and    t.transfer_leg = 'in';
  end if;

  insert into ez_finance.expense_splits
    (workspace_id, transaction_id, debtor_name, amount)
  select p_workspace_id, v_anchor_id,
         pg_catalog.btrim(d ->> 'name'), (d ->> 'amount')::bigint
  from   pg_catalog.jsonb_array_elements(p_debtors) d;

  -- The EXPENSE's id, which is null when your share was zero. The caller uses it to
  -- link to the movement; there being none is a fact, not a failure.
  return v_expense_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_split — someone paid you back.
--
-- The money comes OUT of "Por cobrar" and INTO an account you choose, and the row is
-- stamped. Both in one statement for the same reason as above: a stamp without the
-- transfer says the debt closed and loses the money; a transfer without the stamp
-- leaves the debt open forever and double-counts it the next time.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.settle_split(
  p_split_id      uuid,
  p_to_account_id uuid,
  p_occurred_on   date
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_split      ez_finance.expense_splits;
  v_currency   char(3);
  v_receivable uuid;
begin
  if v_uid is null then
    raise exception 'session_not_found' using errcode = '42501';
  end if;

  -- Locked while we decide, so two taps on the same row cannot both transfer.
  select * into v_split
  from   ez_finance.expense_splits
  where  id = p_split_id
  for    update;

  if v_split.id is null then
    raise exception 'not_permitted' using errcode = '42501';
  end if;

  if v_split.workspace_id not in (
    select ez_finance_private.transacting_workspace_ids_for_current_user()
  ) then
    raise exception 'not_permitted' using errcode = '42501';
  end if;

  if v_split.settled_at is not null then
    raise exception 'already_settled' using errcode = '55000';
  end if;

  select w.base_currency into v_currency
  from   ez_finance.workspaces w where w.id = v_split.workspace_id;

  v_receivable := ez_finance_private.receivable_account(v_split.workspace_id);

  perform ez_finance.record_transfer(
    v_split.workspace_id, v_receivable, p_to_account_id,
    v_split.amount, v_split.amount, v_currency, 1, p_occurred_on,
    'Cobro de ' || v_split.debtor_name
  );

  update ez_finance.expense_splits
  set    settled_at = pg_catalog.now()
  where  id = p_split_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege at the grant, not only inside the bodies. Postgres grants EXECUTE
-- to PUBLIC on every new function and this schema was onboarded with `grant all on
-- routines ... to anon`, so the revoke is the half that is easy to forget — and
-- supabase/tests/function_grants.sql now fails the build when it is.
-- ---------------------------------------------------------------------------
revoke execute on function ez_finance.record_split_expense(uuid, uuid, uuid, bigint, date, text, jsonb) from public, anon;
revoke execute on function ez_finance.settle_split(uuid, uuid, date) from public, anon;
revoke execute on function ez_finance_private.receivable_account(uuid) from public, anon, authenticated;

grant execute on function ez_finance.record_split_expense(uuid, uuid, uuid, bigint, date, text, jsonb) to authenticated;
grant execute on function ez_finance.settle_split(uuid, uuid, date) to authenticated;

commit;
