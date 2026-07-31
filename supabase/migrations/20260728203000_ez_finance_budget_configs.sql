-- =============================================================================
-- Migration: ez_finance.budget_configs — the input computeBudget cannot run without
--
-- The engine's FIRST step is validateConfig(config) (budget-engine.ts), and there
-- was nowhere to store one. Without this table the dashboard is unreachable no
-- matter how many transactions exist, which makes it the real blocker in Fase 5.
--
-- Shape from BudgetConfig in src/shared/domain/budget-types.ts: an income mode,
-- an expected income, and three percentages that must sum to 100. 50/30/20 is the
-- default but the person chooses their own — so the split is stored per workspace
-- rather than assumed by the engine's caller.
--
-- WHY IT IS TEMPORAL (effective_from) rather than one row per workspace.
-- §3.4 preserves history: "un reporte de marzo no se rompe porque en mayo la
-- persona archive una categoría". A single mutable row breaks exactly that — raise
-- your expected income in June and every previous month's dashboard silently
-- re-scales, because the engine divides by the income of the config it is handed.
-- This is the same problem the immutable category bucket solved, and it gets the
-- same answer: the past keeps the numbers it was computed with.
--
-- One row per CHANGE, not per month: the config in force for month M is the row
-- with the greatest effective_from <= M. A person who never changes anything has
-- exactly one row, forever.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. The table.
--    Percentages are integers because the engine rejects non-integers
--    ('percentage-not-integer'), and the sum is a CHECK rather than a hope — a
--    config that cannot satisfy validateConfig() should not be storable.
-- ===========================================================================
create table ez_finance.budget_configs (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references ez_finance.workspaces(id) on delete cascade,

  -- Always the FIRST day of the month this config starts applying to. Kept as a
  -- date rather than (year, month) so ordering and comparison are plain SQL.
  effective_from date        not null,

  -- BudgetConfig.incomeMode. 'mayor' is the engine's documented default: it uses
  -- the greater of real and expected income, which is what keeps the dashboard
  -- useful before payday instead of showing everything at 0%.
  income_mode    text        not null default 'mayor'
                             check (income_mode in ('mayor', 'real', 'esperado')),

  -- Money.minorUnits in the workspace base currency. 0 is valid: the engine
  -- defines targets of 0 and a consumption of 0% for a month with no income.
  expected_income bigint     not null default 0 check (expected_income >= 0),

  pct_need       smallint    not null check (pct_need  >= 0),
  pct_want       smallint    not null check (pct_want  >= 0),
  pct_save       smallint    not null check (pct_save  >= 0),

  -- Optional; the engine defaults it to 80 when absent.
  near_limit_pct smallint    check (near_limit_pct between 1 and 100),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint budget_configs_percentages_sum_100
    check (pct_need + pct_want + pct_save = 100),

  -- effective_from must be a month boundary, or "the config in force for month M"
  -- stops being well defined.
  constraint budget_configs_effective_from_is_month_start
    check (effective_from = date_trunc('month', effective_from)::date)
);

-- One config per workspace per month boundary. A second edit in the same month
-- UPDATEs that row rather than stacking another.
create unique index budget_configs_workspace_month_unique
  on ez_finance.budget_configs (workspace_id, effective_from);

alter table ez_finance.budget_configs enable row level security;

create trigger budget_configs_set_updated_at
  before update on ez_finance.budget_configs
  for each row
  execute function ez_finance_private.set_updated_at();

-- ===========================================================================
-- 2. ez_finance.budget_config_for(workspace_id, month)
--    The config in force for a month: the most recent one starting at or before
--    it. Returns no row when the workspace has never had a config, which is how
--    the app knows onboarding is unfinished.
--
--    A function rather than a view so the "greatest effective_from <= M" rule
--    lives in ONE place — every caller that reimplemented it would be a chance to
--    get the boundary wrong.
-- ===========================================================================
create or replace function ez_finance.budget_config_for(
  p_workspace_id uuid,
  p_month        date
)
  returns table (
    income_mode     text,
    expected_income bigint,
    pct_need        smallint,
    pct_want        smallint,
    pct_save        smallint,
    near_limit_pct  smallint,
    effective_from  date
  )
  language sql
  security invoker
  stable
  set search_path to ''
as $$
  select c.income_mode, c.expected_income, c.pct_need, c.pct_want, c.pct_save,
         c.near_limit_pct, c.effective_from
  from   ez_finance.budget_configs c
  where  c.workspace_id   = p_workspace_id
  and    c.effective_from <= pg_catalog.date_trunc('month', p_month)::date
  order  by c.effective_from desc
  limit  1
$$;

-- SECURITY INVOKER, deliberately: the caller's own RLS decides what they can see,
-- so this cannot become a way to read another workspace's budget.
grant execute on function ez_finance.budget_config_for(uuid, date) to authenticated;

-- ===========================================================================
-- 3. RLS — spec §4, "Gestionar cuentas, categorías y presupuesto": owner and
--    admin write, every role reads. Same split as accounts and categories.
-- ===========================================================================
create policy budget_configs_select_member
  on ez_finance.budget_configs
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy budget_configs_insert_manager
  on ez_finance.budget_configs
  for insert
  to authenticated
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy budget_configs_update_manager
  on ez_finance.budget_configs
  for update
  to authenticated
  using      (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()))
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy budget_configs_delete_manager
  on ez_finance.budget_configs
  for delete
  to authenticated
  using (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

grant select, insert, update, delete on ez_finance.budget_configs to authenticated;

commit;
