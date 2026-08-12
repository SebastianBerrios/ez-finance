-- =============================================================================
-- Expense splits: a shared expense, and who still owes you for it (spec §5.9).
--
-- THE MODEL, decided with the user, and the reason it is shaped this way.
--
-- Paying 900 for something you split 300/600 records TWO things:
--
--   * an expense of 300 in its category  → consumes the right bucket
--   * a transfer of 600 to a "Por cobrar" account → the 900 really left
--
-- Getting paid back is a transfer of 600 the other way.
--
-- WHY THIS DOES NOT TOUCH THE BUDGET ENGINE, which is the point. The engine already
-- treats `operational → operational` transfers as NEUTRAL, consuming no bucket
-- (transfer-classifier.ts, and the table in its header); only
-- `operational → savings` feeds the savings bucket. So both legs of a reimbursement
-- are invisible to the 50/30/20 without changing a line of the most-tested pure code
-- in the app.
--
-- And nothing inflates INCOME. Booking the repayment as income was the obvious
-- alternative and it is wrong: §1 of the functional spec computes the whole method
-- over the month's income, so inflating it raises all three targets and shows more
-- room than exists — exactly the "engañoso" the spec sets out to avoid.
--
-- THE CRITICAL CONSEQUENCE. The receivable account must NOT be type `savings`, or
-- lending a friend money would count as savings consumed. Hence a new type, which is
-- a CHECK change on accounts.type — incomparably cheaper than touching the engine.
--
-- DEBTORS ARE FREE TEXT, not app users. Invitations do not exist and are blocked
-- behind graduation (mvp-lab shares one auth.users pool across the fleet), so a debtor
-- has to be a name the workspace's own people write down. If it were an invited
-- person, splits would be blocked behind graduation just like collaboration is.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The new account type.
--
--    'receivable' is money OWED TO the workspace, not money it holds. It is an asset
--    account in the ordinary accounting sense, and giving it its own type is what
--    keeps it out of the savings bucket.
--
--    DROP AND ADD, because a CHECK constraint cannot be extended in place. Same
--    transaction, so no window exists where a valid row would be refused.
-- ---------------------------------------------------------------------------
alter table ez_finance.accounts
  drop constraint accounts_type_check;

alter table ez_finance.accounts
  add constraint accounts_type_check
  check (type in ('cash', 'bank', 'card', 'wallet', 'investment', 'savings', 'receivable'));

-- ---------------------------------------------------------------------------
-- 2. One row per person who owes you for one expense.
--
--    The "Por cobrar" account carries the TOTAL — it is a balance, derived like any
--    other. This table carries the BREAKDOWN: which expense, which person, how much,
--    and whether it came back. Neither is derivable from the other, and the balance
--    is what the dashboard already knows how to show.
-- ---------------------------------------------------------------------------
create table ez_finance.expense_splits (
  id             uuid        primary key default gen_random_uuid(),
  -- Denormalised like every other table here so RLS predicates can be written
  -- against it directly. The trigger below proves it agrees with the transaction.
  workspace_id   uuid        not null references ez_finance.workspaces(id) on delete cascade,
  -- RESTRICT, not CASCADE: a split is the explanation for a transfer that already
  -- moved money. Deleting the expense out from under it would leave the "Por cobrar"
  -- balance with no story. Movements are deleted deliberately, and this makes the
  -- order explicit rather than silent.
  transaction_id uuid        not null references ez_finance.transactions(id) on delete restrict,
  -- A NAME, not a user id. See the header: invitations do not exist.
  debtor_name    text        not null check (btrim(debtor_name) <> '' and length(debtor_name) <= 80),
  -- Minor units, strictly positive. A split of zero is not a split.
  amount         bigint      not null check (amount > 0),
  -- Stamped when the money came back. NULL means still owed.
  settled_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
  -- No unique constraint on (transaction, debtor) on purpose: two flatmates called
  -- "Ana" is a real thing, and refusing it would be the schema guessing.
);

create index expense_splits_workspace_idx  on ez_finance.expense_splits (workspace_id);
create index expense_splits_transaction_idx on ez_finance.expense_splits (transaction_id);
-- The list people actually ask for: what is still owed.
create index expense_splits_unsettled_idx
  on ez_finance.expense_splits (workspace_id)
  where settled_at is null;

alter table ez_finance.expense_splits enable row level security;

create trigger expense_splits_set_updated_at
  before update on ez_finance.expense_splits
  for each row
  execute function ez_finance_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. The cross-workspace guard.
--
--    RLS does not cover this, the same way it did not for goals and category limits:
--    someone with two spaces can legitimately see both, so the transaction id can
--    pass a policy while belonging to a different space than the row claims. Only a
--    trigger compares them.
--
--    It also refuses a split on a TRANSFER leg. A split explains a shared expense;
--    attaching one to a transfer would claim someone owes you for money you moved
--    between your own accounts.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.expense_splits_validate_refs()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_kind text;
begin
  select t.kind
  into   v_kind
  from   ez_finance.transactions t
  where  t.id = new.transaction_id
  and    t.workspace_id = new.workspace_id;

  if v_kind is null then
    raise exception 'transaction_not_in_workspace' using errcode = '23514';
  end if;

  if v_kind <> 'expense' then
    raise exception 'split_requires_expense' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger expense_splits_validate_refs
  before insert or update of workspace_id, transaction_id
  on ez_finance.expense_splits
  for each row
  execute function ez_finance_private.expense_splits_validate_refs();

-- ---------------------------------------------------------------------------
-- 4. RLS — a split is a movement, not configuration.
--
--    So it follows the TRANSACTING roles (owner, admin, member), not the managing
--    ones: whoever may record a shared expense may say who owes for it. Observers
--    read, like everywhere else.
--
--    Using transacting_workspace_ids_for_current_user() also means an ARCHIVED
--    workspace refuses these writes, without this migration knowing that rule exists.
-- ---------------------------------------------------------------------------
create policy expense_splits_select_member
  on ez_finance.expense_splits
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy expense_splits_insert_transacting
  on ez_finance.expense_splits
  for insert
  to authenticated
  with check (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()));

create policy expense_splits_update_transacting
  on ez_finance.expense_splits
  for update
  to authenticated
  using      (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()))
  with check (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()));

create policy expense_splits_delete_transacting
  on ez_finance.expense_splits
  for delete
  to authenticated
  using (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()));

commit;
