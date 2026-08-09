-- =============================================================================
-- Per-category spending limits.
--
-- THE ENGINE ALREADY DOES THIS. `BudgetConfig.categoryLimits` exists in
-- shared/domain/budget-types.ts, budget-engine.ts validates that every limit's
-- currency matches the snapshot's, and alerts.ts emits a per-category alert when one
-- is neared or passed — all of it tested. Nothing has ever been able to SET one:
-- ez_finance.budget_configs has no column for it and no screen asks. Spec §5.6 lists
-- "opcionalmente, fijar límites por categoría", so the half that was missing is the
-- boring half, and its absence made the other half dead code.
--
-- WHY A TABLE AND NOT A COLUMN. A config has zero or many limits, one per category;
-- a jsonb column would put referential integrity in application code, and a category
-- id that no longer exists is exactly the kind of drift the engine then has to
-- "silently ignore".
--
-- WHY IT HANGS OFF budget_configs AND NOT THE WORKSPACE. A budget config is already
-- versioned by effective_from — the percentages and the expected income can change
-- from one month to the next, and budget_config_for() resolves "the one in force for
-- month M". A limit is part of that same answer: raising the groceries ceiling in
-- August must not rewrite what July was measured against, or every past month's
-- alerts change retroactively. Hanging limits off the workspace would have made them
-- the one part of a budget that cannot have history.
--
-- workspace_id is carried on the row rather than reached through the join. Every
-- other table in this schema does, RLS predicates are written against it, and a
-- policy that had to join two tables to find the workspace would be both slower and
-- easier to get wrong. The trigger below is what keeps it honest.
-- =============================================================================

begin;

create table ez_finance.category_limits (
  -- Denormalised on purpose; see the header. The trigger proves it agrees with both
  -- parents.
  workspace_id     uuid   not null references ez_finance.workspaces(id) on delete cascade,
  -- CASCADE: a limit is part of its config. When that version of the budget goes, so
  -- does what it measured against.
  budget_config_id uuid   not null references ez_finance.budget_configs(id) on delete cascade,
  -- RESTRICT, like every other reference to a category in this schema: categories are
  -- archived, never deleted, and a limit is not a reason to make an exception.
  category_id      uuid   not null references ez_finance.categories(id) on delete restrict,
  -- Minor units, like every amount here. Strictly positive: a limit of zero is not a
  -- limit, it is a prohibition, and the app has no way to express that — someone who
  -- means it removes the category from the picker by archiving it.
  limit_amount     bigint not null check (limit_amount > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- One limit per category per config. The UPSERT the app performs depends on this.
  primary key (budget_config_id, category_id)
);

create index category_limits_workspace_idx
  on ez_finance.category_limits (workspace_id);

alter table ez_finance.category_limits enable row level security;

create trigger category_limits_set_updated_at
  before update on ez_finance.category_limits
  for each row
  execute function ez_finance_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The cross-workspace guard.
--
-- RLS does NOT cover this, for the same reason it did not cover it for goals
-- (20260802100000): a person with two spaces can legitimately see both, so every id
-- in this row can pass a policy while still belonging to a DIFFERENT space than the
-- row claims. Only a trigger can compare them.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.category_limits_validate_refs()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
begin
  if not exists (
    select 1 from ez_finance.budget_configs c
    where  c.id = new.budget_config_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'budget_config_not_in_workspace' using errcode = '23514';
  end if;

  if not exists (
    select 1 from ez_finance.categories cat
    where  cat.id = new.category_id and cat.workspace_id = new.workspace_id
  ) then
    raise exception 'category_not_in_workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger category_limits_validate_refs
  before insert or update of workspace_id, budget_config_id, category_id
  on ez_finance.category_limits
  for each row
  execute function ez_finance_private.category_limits_validate_refs();

-- ---------------------------------------------------------------------------
-- RLS — spec §4: owner and admin write, every role reads. Identical split to
-- budget_configs, because a limit IS budget configuration.
--
-- The write policies use managed_workspace_ids_for_current_user(), so an archived
-- workspace refuses these too, without this migration knowing that rule exists.
-- ---------------------------------------------------------------------------
create policy category_limits_select_member
  on ez_finance.category_limits
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy category_limits_insert_manager
  on ez_finance.category_limits
  for insert
  to authenticated
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy category_limits_update_manager
  on ez_finance.category_limits
  for update
  to authenticated
  using      (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()))
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy category_limits_delete_manager
  on ez_finance.category_limits
  for delete
  to authenticated
  using (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

-- ---------------------------------------------------------------------------
-- budget_config_for() now answers with the limits too.
--
-- ONE CALL, not two. The dashboard resolves the config on every render, and a second
-- round trip for the limits would be a second chance to disagree about WHICH config
-- they belong to — the whole reason this function exists is that "the config in force
-- for month M" is a rule that must live in exactly one place.
--
-- The id is returned as well: the app needs it to write a limit against the config it
-- just read, and deriving it again in the adapter would be that same rule, twice.
--
-- DROP and CREATE, because Postgres refuses to replace a function whose OUT
-- parameters change, and a RETURNS TABLE is OUT parameters. Both statements are in
-- this transaction, so no window exists where the app finds it missing. The grant is
-- re-asserted rather than assumed to survive — 20260728161500 lost bootstrap()'s
-- deletion guard to exactly that assumption.
-- ---------------------------------------------------------------------------
drop function if exists ez_finance.budget_config_for(uuid, date);

create function ez_finance.budget_config_for(
  p_workspace_id uuid,
  p_month        date
)
  returns table (
    id              uuid,
    income_mode     text,
    expected_income bigint,
    pct_need        smallint,
    pct_want        smallint,
    pct_save        smallint,
    near_limit_pct  smallint,
    effective_from  date,
    -- [] rather than null when there are none, so the caller has one shape to read.
    category_limits jsonb
  )
  language sql
  security invoker
  stable
  set search_path to ''
as $$
  select c.id, c.income_mode, c.expected_income, c.pct_need, c.pct_want, c.pct_save,
         c.near_limit_pct, c.effective_from,
         coalesce(
           (select pg_catalog.jsonb_agg(
                     pg_catalog.jsonb_build_object(
                       'category_id', l.category_id,
                       -- TEXT, not a json number: limit_amount is a bigint and a JSON
                       -- number goes through a double on the way out, which loses
                       -- precision past 2^53. Every amount in this app crosses the
                       -- wire as a string for that reason.
                       'limit_amount', l.limit_amount::text
                     )
                     order by l.category_id
                   )
            from   ez_finance.category_limits l
            where  l.budget_config_id = c.id),
           '[]'::jsonb
         )
  from   ez_finance.budget_configs c
  where  c.workspace_id   = p_workspace_id
  and    c.effective_from <= pg_catalog.date_trunc('month', p_month)::date
  order  by c.effective_from desc
  limit  1
$$;

-- SECURITY INVOKER, deliberately: the caller's own RLS decides what they can see, so
-- this cannot become a way to read another workspace's budget. That applies to the
-- embedded limits as well — the subquery runs as the caller.
revoke execute on function ez_finance.budget_config_for(uuid, date) from public, anon;
grant  execute on function ez_finance.budget_config_for(uuid, date) to authenticated;

commit;
