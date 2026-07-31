-- =============================================================================
-- Migration: workspace base currency + ez_finance.transactions (Fase 5)
--
-- Shaped by SnapshotTransaction in src/shared/domain/budget-types.ts, which the
-- engine already reads:
--   * amount is a POSITIVE magnitude in the WORKSPACE BASE CURRENCY. Sign comes
--     from `kind`, never from the number, so base_amount is checked > 0.
--   * a transfer is a TIED PAIR of two rows sharing transfer_id, one leg 'out'
--     and one 'in', each naming the other account in counter_account_id.
--   * category_id is present for income/expense and ABSENT on transfer legs.
--
-- WHY workspaces.base_currency IS NULLABLE. MonthlySnapshot.baseCurrency is a
-- per-workspace value and the table had none. Giving it `not null default 'USD'`
-- would guess, and the guess is unusually expensive here: every transaction
-- freezes a converted base_amount at write time and the rate is never recomputed
-- (spec §5.5), so the base currency cannot change once transactions exist. That
-- is the same reason no default ACCOUNT is seeded at bootstrap.
--
-- So it starts NULL and the FIRST ACCOUNT created in the workspace sets it
-- (section 2). A workspace with no accounts needs no base currency, because it
-- cannot hold a transaction. After it is set, it is immutable.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. workspaces.base_currency
-- ===========================================================================
alter table ez_finance.workspaces
  add column base_currency char(3);

-- ===========================================================================
-- 2. The first account adopts the workspace's base currency.
--    A trigger rather than app code, so the invariant holds no matter which path
--    creates the account (client insert, RPC, future import). Runs AFTER INSERT:
--    the account row is the source of truth for the value.
-- ===========================================================================
create or replace function ez_finance_private.workspaces_adopt_base_currency()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
begin
  update ez_finance.workspaces
  set    base_currency = new.currency
  where  id = new.workspace_id
  and    base_currency is null;

  return null;
end;
$$;

create trigger accounts_set_workspace_base_currency
  after insert on ez_finance.accounts
  for each row
  execute function ez_finance_private.workspaces_adopt_base_currency();

-- ===========================================================================
-- 3. Base currency is immutable once set.
--    Every base_amount already stored was converted with a rate frozen against
--    this currency. Changing it would silently reinterpret all of them.
--    NULL -> value is the adoption above and must stay allowed.
-- ===========================================================================
create or replace function ez_finance_private.workspaces_reject_base_currency_change()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
begin
  if old.base_currency is not null and new.base_currency is distinct from old.base_currency then
    raise exception
      'workspace base currency is immutable once set (workspace %); every stored base_amount was frozen against it', old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger workspaces_base_currency_immutable
  before update of base_currency on ez_finance.workspaces
  for each row
  execute function ez_finance_private.workspaces_reject_base_currency_change();

-- ===========================================================================
-- 4. ez_finance.transactions
-- ===========================================================================
create table ez_finance.transactions (
  id                 uuid        primary key default gen_random_uuid(),
  workspace_id       uuid        not null references ez_finance.workspaces(id) on delete cascade,
  -- RESTRICT, not CASCADE: deleting an account must not silently erase history.
  -- Accounts are archived, never deleted, once they carry movements.
  account_id         uuid        not null references ez_finance.accounts(id) on delete restrict,
  kind               text        not null check (kind in ('income', 'expense', 'transfer')),

  -- What the engine reads. Positive magnitude, workspace base currency.
  base_amount        bigint      not null check (base_amount > 0),

  -- What the person typed, kept verbatim so the record stays honest even when
  -- entered_currency differs from the base.
  entered_amount     bigint      not null check (entered_amount > 0),
  entered_currency   char(3)     not null,
  -- Frozen at write time and NEVER recomputed (spec §5.5). Equal to 1 when the
  -- entered currency is already the base.
  exchange_rate      numeric(20, 10) not null check (exchange_rate > 0),

  -- Date-only, workspace-local. A timestamptz would drag the viewer's timezone
  -- into which MONTH a movement belongs to, which is the engine's grouping key.
  occurred_on        date        not null,

  category_id        uuid        references ez_finance.categories(id) on delete restrict,
  note               text        check (note is null or length(note) <= 500),

  -- Transfer pair. Both legs share transfer_id; each names the other account.
  transfer_id        uuid,
  transfer_leg       text        check (transfer_leg in ('out', 'in')),
  counter_account_id uuid        references ez_finance.accounts(id) on delete restrict,

  -- Nullable + SET NULL so history survives the author's account deletion, the
  -- same golden rule workspace_members follows.
  created_by         uuid        references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- The engine's shape, enforced rather than hoped for: transfer legs carry the
  -- pair columns and NO category; income/expense carry neither.
  constraint transactions_kind_shape check (
    case kind
      when 'transfer' then
        transfer_id is not null
        and transfer_leg is not null
        and counter_account_id is not null
        and category_id is null
      else
        transfer_id is null
        and transfer_leg is null
        and counter_account_id is null
    end
  ),

  -- A transfer between one account and itself moves nothing.
  constraint transactions_transfer_distinct_accounts check (
    counter_account_id is null or counter_account_id <> account_id
  )
);

-- One 'out' and one 'in' per transfer_id — this is what stops a second 'out' leg
-- from being appended to an existing pair.
create unique index transactions_transfer_leg_unique
  on ez_finance.transactions (transfer_id, transfer_leg)
  where transfer_id is not null;

-- The engine reads a month at a time, per workspace.
create index transactions_workspace_month_idx
  on ez_finance.transactions (workspace_id, occurred_on);
create index transactions_account_idx  on ez_finance.transactions (account_id);
create index transactions_category_idx on ez_finance.transactions (category_id) where category_id is not null;

alter table ez_finance.transactions enable row level security;

create trigger transactions_set_updated_at
  before update on ez_finance.transactions
  for each row
  execute function ez_finance_private.set_updated_at();

-- ===========================================================================
-- 5. Referential rules a foreign key cannot express.
--    Every referenced row must live in the SAME workspace, or one workspace's
--    movements could point at another's accounts and categories — and the FKs
--    above only prove the rows exist.
--    Also: base_amount is denominated in the workspace base currency, so writing
--    a transaction before that currency exists would store an unanchored number.
-- ===========================================================================
create or replace function ez_finance_private.transactions_validate_refs()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_base char(3);
begin
  select base_currency into v_base
  from   ez_finance.workspaces
  where  id = new.workspace_id;

  if v_base is null then
    raise exception
      'workspace % has no base currency yet: create an account first', new.workspace_id
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from ez_finance.accounts
    where id = new.account_id and workspace_id = new.workspace_id
  ) then
    raise exception 'account % is not in workspace %', new.account_id, new.workspace_id
      using errcode = 'P0001';
  end if;

  if new.counter_account_id is not null and not exists (
    select 1 from ez_finance.accounts
    where id = new.counter_account_id and workspace_id = new.workspace_id
  ) then
    raise exception 'counter account % is not in workspace %', new.counter_account_id, new.workspace_id
      using errcode = 'P0001';
  end if;

  if new.category_id is not null and not exists (
    select 1 from ez_finance.categories
    where id = new.category_id and workspace_id = new.workspace_id
  ) then
    raise exception 'category % is not in workspace %', new.category_id, new.workspace_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger transactions_validate_refs
  before insert or update of workspace_id, account_id, counter_account_id, category_id
  on ez_finance.transactions
  for each row
  execute function ez_finance_private.transactions_validate_refs();

-- ===========================================================================
-- 6. ez_finance_private.transacting_workspace_ids_for_current_user()
--    Spec §4: "Registrar / editar transacciones propias" is member, admin and
--    owner — an OBSERVER may read the workspace but records nothing. Third
--    definer helper alongside its siblings, same anti-recursion rationale.
-- ===========================================================================
create or replace function ez_finance_private.transacting_workspace_ids_for_current_user()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path to ''
as $$
  select workspace_id
  from   ez_finance.workspace_members
  where  user_id = (select auth.uid())
  and    role in ('owner', 'admin', 'member')
$$;

-- ===========================================================================
-- 7. RLS.
--    SELECT: every role of the workspace, observers included — they are there to
--            see the numbers.
--    WRITE:  the AUTHOR only, and never an observer. "Transacciones propias" is
--            read literally: created_by = auth.uid(). Admins and owners shape the
--            workspace's configuration (accounts, categories, budget) but do not
--            rewrite someone else's movements.
--
--    Transfers are NOT insertable directly: a single leg is a broken pair, and no
--    row-level policy can require its sibling. record_transfer() (section 8)
--    writes both in one statement, so the policy here refuses kind='transfer'.
-- ===========================================================================
create policy transactions_select_member
  on ez_finance.transactions
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy transactions_insert_author
  on ez_finance.transactions
  for insert
  to authenticated
  with check (
    workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user())
    and created_by = (select auth.uid())
    and kind <> 'transfer'
  );

create policy transactions_update_author
  on ez_finance.transactions
  for update
  to authenticated
  using      (
    workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user())
    and created_by = (select auth.uid())
  )
  with check (
    workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user())
    and created_by = (select auth.uid())
  );

create policy transactions_delete_author
  on ez_finance.transactions
  for delete
  to authenticated
  using (
    workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user())
    and created_by = (select auth.uid())
  );

-- ===========================================================================
-- 8. ez_finance.record_transfer() / delete_transfer()
--    "Se crean y se deshacen juntas" (spec §5.5) is a multi-row invariant, so it
--    lives in an RPC rather than a policy. SECURITY DEFINER to bypass the
--    kind <> 'transfer' guard above, but it re-checks membership itself — a
--    definer function that trusts its caller is an open door.
-- ===========================================================================
create or replace function ez_finance.record_transfer(
  p_workspace_id       uuid,
  p_from_account_id    uuid,
  p_to_account_id      uuid,
  p_base_amount        bigint,
  p_entered_amount     bigint,
  p_entered_currency   char(3),
  p_exchange_rate      numeric,
  p_occurred_on        date,
  p_note               text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_uid         uuid;
  v_transfer_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'record_transfer() requires an authenticated session'
      using errcode = 'P0001';
  end if;

  -- The definer bypasses RLS, so authorization is re-established here.
  if p_workspace_id not in (
    select ez_finance_private.transacting_workspace_ids_for_current_user()
  ) then
    raise exception 'not allowed to record transactions in workspace %', p_workspace_id
      using errcode = 'P0001';
  end if;

  v_transfer_id := pg_catalog.gen_random_uuid();

  -- Both legs in ONE statement: there is no window in which half a pair exists,
  -- even if the transaction later rolls back.
  insert into ez_finance.transactions (
    workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
    exchange_rate, occurred_on, note, transfer_id, transfer_leg, counter_account_id, created_by
  )
  values
    (p_workspace_id, p_from_account_id, 'transfer', p_base_amount, p_entered_amount,
     p_entered_currency, p_exchange_rate, p_occurred_on, p_note, v_transfer_id, 'out',
     p_to_account_id, v_uid),
    (p_workspace_id, p_to_account_id, 'transfer', p_base_amount, p_entered_amount,
     p_entered_currency, p_exchange_rate, p_occurred_on, p_note, v_transfer_id, 'in',
     p_from_account_id, v_uid);

  return v_transfer_id;
end;
$$;

create or replace function ez_finance.delete_transfer(p_transfer_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_uid     uuid;
  v_deleted integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'delete_transfer() requires an authenticated session'
      using errcode = 'P0001';
  end if;

  -- Deletes BOTH legs or neither, and only the caller's own pair — the same
  -- "transacciones propias" rule the DELETE policy applies to single rows.
  delete from ez_finance.transactions
  where transfer_id = p_transfer_id
  and   created_by  = v_uid
  and   workspace_id in (
          select ez_finance_private.transacting_workspace_ids_for_current_user()
        );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function ez_finance.record_transfer(uuid, uuid, uuid, bigint, bigint, char, numeric, date, text) to authenticated;
grant execute on function ez_finance.delete_transfer(uuid) to authenticated;

grant select, insert, update, delete on ez_finance.transactions to authenticated;

commit;
