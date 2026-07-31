-- =============================================================================
-- Migration: ez_finance accounts + categories (Fase 4)
--
-- The two tables the budget engine reads as SnapshotAccount and
-- SnapshotCategory. Their shapes are dictated by the engine, which is already
-- implemented and tested (src/modules/budget/domain, src/shared/domain/
-- budget-types.ts) — this migration follows that contract, it does not invent
-- one:
--   * account.type mirrors AccountType exactly, INCLUDING 'savings' as a type
--     of its own. The engine derives isSavings = type === 'savings'. The
--     functional spec §5.3 still asks whether savings should instead be a flag
--     on bank/investment; the engine answered that question first and changing
--     it now would mean rewriting Fase 1.
--   * category.bucket mirrors Bucket, and is NULLABLE — the engine's documented
--     "unbucketed" case, which it counts per category but in no bucket.
--   * Money is { currency, minorUnits: bigint } (src/shared/domain/money.ts),
--     so amounts are bigint minor units plus a char(3) code, never numeric.
--
-- Permissions come from spec §4, which is [ESPECIFICADO]: "Gestionar cuentas,
-- categorías y presupuesto" is ADMIN AND OWNER ONLY. Members and observers get
-- SELECT. Building membership-only policies here would be wrong today and a
-- rewrite when Fase 3 lands shared workspaces, so the role split is enforced
-- from the start even though a Personal workspace only ever has an owner.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. ez_finance_private.managed_workspace_ids_for_current_user()
--    Companion to workspace_ids_for_current_user(): the workspaces where the
--    caller may MANAGE configuration, i.e. is owner or admin.
--
--    SECURITY DEFINER for the same reason as its sibling — it runs as owner so
--    it bypasses RLS on workspace_members, which is what keeps the policies
--    below from recursing into that table's own policies.
-- ===========================================================================
create or replace function ez_finance_private.managed_workspace_ids_for_current_user()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path to ''
as $$
  select workspace_id
  from   ez_finance.workspace_members
  where  user_id = (select auth.uid())
  and    role in ('owner', 'admin')
$$;

-- ===========================================================================
-- 2. ez_finance.accounts
--    Where a workspace's money lives. Balance is NEVER stored: it is
--    initial_balance plus the sum of the account's transactions (spec §5.3,
--    "el saldo de una cuenta se calcula, no se edita a mano"), so there is
--    deliberately no balance column to drift.
--
--    Archiving is logical and keeps history: an archived account's movements
--    still count in reports, exactly like archived categories do in the engine.
--    Archiving an account whose balance is not zero IS allowed — the balance is
--    derived, so refusing would protect nothing.
-- ===========================================================================
create table ez_finance.accounts (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references ez_finance.workspaces(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 80),
  -- Mirrors AccountType in src/shared/domain/budget-types.ts.
  type            text        not null check (type in ('cash', 'bank', 'card', 'wallet', 'investment', 'savings')),
  -- ISO 4217. Immutable after creation — see the trigger in section 3.
  currency        char(3)     not null,
  -- Money.minorUnits: signed bigint. A card account legitimately starts negative.
  initial_balance bigint      not null default 0,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index accounts_workspace_idx on ez_finance.accounts (workspace_id);

alter table ez_finance.accounts enable row level security;

create trigger accounts_set_updated_at
  before update on ez_finance.accounts
  for each row
  execute function ez_finance_private.set_updated_at();

-- ===========================================================================
-- 3. Account currency is immutable.
--    Every transaction freezes its exchange rate at write time and it is never
--    recalculated (spec §5.5). Letting an account's currency change afterwards
--    would silently reinterpret every frozen amount already recorded against
--    it, so the rule is enforced here rather than trusted to the app.
-- ===========================================================================
create or replace function ez_finance_private.accounts_reject_currency_change()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
begin
  if new.currency <> old.currency then
    raise exception 'account currency is immutable (account %)', old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger accounts_currency_immutable
  before update of currency on ez_finance.accounts
  for each row
  execute function ez_finance_private.accounts_reject_currency_change();

-- ===========================================================================
-- 4. ez_finance.categories
--    Classifies transactions into the 50/30/20 buckets.
--
--    NO unique constraint on (workspace_id, name), deliberately: re-bucketing a
--    category is done by archiving it and creating a replacement (section 5),
--    which means two rows legitimately share a name — one archived carrying the
--    old bucket, one active carrying the new one. A unique name would forbid
--    the very path this design depends on.
-- ===========================================================================
create table ez_finance.categories (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references ez_finance.workspaces(id) on delete cascade,
  name         text        not null check (length(btrim(name)) between 1 and 60),
  -- Mirrors Bucket. NULL is the engine's documented "unbucketed" case: such
  -- expenses are totalled per category but land in no bucket.
  bucket       text        check (bucket in ('need', 'want', 'save')),
  -- Parent/child only, never deeper — enforced in section 6.
  -- ON DELETE RESTRICT: losing a parent would silently reparent history.
  parent_id    uuid        references ez_finance.categories(id) on delete restrict,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index categories_workspace_idx on ez_finance.categories (workspace_id);
create index categories_parent_idx    on ez_finance.categories (parent_id) where parent_id is not null;

alter table ez_finance.categories enable row level security;

create trigger categories_set_updated_at
  before update on ez_finance.categories
  for each row
  execute function ez_finance_private.set_updated_at();

-- ===========================================================================
-- 5. Category bucket is immutable.
--    THIS IS THE HISTORY-PRESERVATION RULE, and it is why the engine needs no
--    change to satisfy it.
--
--    The engine resolves a bucket per CATEGORY, not per transaction
--    (transfer-classifier.ts builds categoryBucket from snapshot.categories and
--    looks up tx.categoryId). So a mutable bucket would retroactively re-bucket
--    every past month — the opposite of §3's history preservation — while
--    storing the bucket on the transaction instead would break the engine's
--    input contract, since one category can hold only one bucket per snapshot.
--
--    Instead: archive the category and create a replacement. Old transactions
--    keep pointing at the archived row, which keeps its bucket, and the engine
--    already counts archived categories ("archived categories STILL COUNT").
--    History stays exact, the engine stays untouched, and a mid-month change
--    splits that month across both buckets — which is the honest answer.
-- ===========================================================================
create or replace function ez_finance_private.categories_reject_bucket_change()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
begin
  if new.bucket is distinct from old.bucket then
    raise exception
      'category bucket is immutable (category %); archive it and create a replacement so past months keep their bucket', old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger categories_bucket_immutable
  before update of bucket on ez_finance.categories
  for each row
  execute function ez_finance_private.categories_reject_bucket_change();

-- ===========================================================================
-- 6. Category hierarchy: same workspace, exactly two levels.
--    Spec §5.4 describes "categoría padre y subcategorías" — one level of
--    nesting, matching the engine's single optional parentId. A cross-workspace
--    parent would leak one workspace's structure into another, so both rules
--    live in one trigger (neither is expressible as a table CHECK, which cannot
--    read other rows).
-- ===========================================================================
create or replace function ez_finance_private.categories_validate_parent()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_parent_workspace uuid;
  v_parent_parent    uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a category cannot be its own parent (%)', new.id
      using errcode = 'P0001';
  end if;

  select workspace_id, parent_id
  into   v_parent_workspace, v_parent_parent
  from   ez_finance.categories
  where  id = new.parent_id;

  if v_parent_workspace is null then
    raise exception 'parent category % does not exist', new.parent_id
      using errcode = 'P0001';
  end if;

  if v_parent_workspace <> new.workspace_id then
    raise exception 'parent category % belongs to another workspace', new.parent_id
      using errcode = 'P0001';
  end if;

  if v_parent_parent is not null then
    raise exception
      'categories nest one level only: % is already a subcategory', new.parent_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger categories_validate_parent
  before insert or update of parent_id, workspace_id on ez_finance.categories
  for each row
  execute function ez_finance_private.categories_validate_parent();

-- ===========================================================================
-- 7. RLS policies — spec §4.
--    SELECT: every role of the workspace, including observer, so reports and
--    the transaction form can name accounts and categories.
--    WRITE:  owner and admin only ("Gestionar cuentas, categorías y
--            presupuesto"). A member records transactions but does not shape
--            the workspace's configuration.
--    DELETE is granted to the same roles as INSERT/UPDATE, but archiving is the
--    intended path — a hard delete is only meaningful for a row created by
--    mistake and never referenced.
-- ===========================================================================
create policy accounts_select_member
  on ez_finance.accounts
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy accounts_insert_manager
  on ez_finance.accounts
  for insert
  to authenticated
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy accounts_update_manager
  on ez_finance.accounts
  for update
  to authenticated
  using      (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()))
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy accounts_delete_manager
  on ez_finance.accounts
  for delete
  to authenticated
  using (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy categories_select_member
  on ez_finance.categories
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy categories_insert_manager
  on ez_finance.categories
  for insert
  to authenticated
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy categories_update_manager
  on ez_finance.categories
  for update
  to authenticated
  using      (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()))
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy categories_delete_manager
  on ez_finance.categories
  for delete
  to authenticated
  using (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

-- ===========================================================================
-- 8. Grants.
--    The exposed schema's tables need table-level privileges on top of RLS;
--    anon gets nothing (there is no unauthenticated path to a workspace).
-- ===========================================================================
grant select, insert, update, delete on ez_finance.accounts   to authenticated;
grant select, insert, update, delete on ez_finance.categories to authenticated;

commit;
