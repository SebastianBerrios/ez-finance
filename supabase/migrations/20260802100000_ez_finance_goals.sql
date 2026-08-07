-- =============================================================================
-- Migration: savings goals
--
-- A goal is a TARGET AMOUNT with a name, and optionally a date. What it is NOT is a
-- second ledger: progress is not a column someone increments, it is derived from the
-- transactions that already exist. Storing a running total would create a number that
-- can disagree with the movements it claims to summarise — the same mistake
-- account_balances() exists to avoid, and the reason there is no `saved_amount` here.
--
-- HOW PROGRESS IS DERIVED. A goal points at ONE savings account, and its progress is
-- that account's balance. This is deliberately the simplest rule that is honest: the
-- money is really there, in an account you can see, and the goal is a label on it plus
-- a target. Splitting one account across several goals would require apportioning
-- transactions between them, which is a second ledger by another name.
-- =============================================================================

begin;

create table ez_finance.goals (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references ez_finance.workspaces(id) on delete cascade,

  -- The account whose balance IS the progress. RESTRICT, not CASCADE: deleting an
  -- account that a goal measures would silently delete the goal too, and accounts are
  -- archived rather than deleted anyway — so this should never fire, and if it does,
  -- failing loudly is the right outcome.
  account_id    uuid        not null references ez_finance.accounts(id) on delete restrict,

  name          text        not null check (length(btrim(name)) between 1 and 80),

  -- Minor units of the workspace's base currency, like every other amount here.
  -- Must be POSITIVE: a goal of zero is not a goal, it is a mistake or a placeholder,
  -- and allowing it would make "reached" true the moment the goal is created.
  target_amount bigint      not null check (target_amount > 0),

  -- Optional. A goal without a date is a direction; one with a date is a commitment.
  -- The app treats both as valid rather than forcing a deadline nobody meant.
  target_date   date,

  achieved_at   timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index goals_workspace on ez_finance.goals (workspace_id) where archived_at is null;
create index goals_account   on ez_finance.goals (account_id);

alter table ez_finance.goals enable row level security;

create trigger goals_set_updated_at
  before update on ez_finance.goals
  for each row execute function ez_finance_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The account must belong to the SAME workspace as the goal.
--
-- RLS alone does not cover this. The INSERT policy checks that the GOAL's workspace is
-- one the caller manages, and the caller can equally see another of their own
-- workspaces' accounts — so without this trigger, a person with two spaces could
-- create a goal in one that measures an account in the other, and its progress would
-- come from money the space does not have.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.goals_validate_account()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if not exists (
    select 1 from ez_finance.accounts a
    where a.id = new.account_id and a.workspace_id = new.workspace_id
  ) then
    raise exception 'account_not_in_workspace' using errcode = '23514';
  end if;

  return new;
end;
$function$;

create trigger goals_validate_account
  before insert or update of account_id, workspace_id on ez_finance.goals
  for each row execute function ez_finance_private.goals_validate_account();

-- ---------------------------------------------------------------------------
-- RLS: read as a member, write as a manager. Same matrix as accounts and categories,
-- through the same helpers, so a role change is one definition rather than one per
-- table.
-- ---------------------------------------------------------------------------
create policy goals_select_member
  on ez_finance.goals
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy goals_insert_manager
  on ez_finance.goals
  for insert
  to authenticated
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy goals_update_manager
  on ez_finance.goals
  for update
  to authenticated
  using      (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()))
  with check (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

create policy goals_delete_manager
  on ez_finance.goals
  for delete
  to authenticated
  using (workspace_id in (select ez_finance_private.managed_workspace_ids_for_current_user()));

-- ---------------------------------------------------------------------------
-- Progress, computed. Never stored.
--
-- Returns every non-archived goal of the workspace with the CURRENT balance of the
-- account behind it. `saved` can exceed `target` — reaching a goal and then saving more
-- is not an error — and it can be negative if the account is overdrawn, which is
-- reported rather than clamped: a goal backed by an account in the red is information,
-- not a rendering problem.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.goal_progress(p_workspace_id uuid)
  returns table (
    id            uuid,
    name          text,
    account_id    uuid,
    account_name  text,
    target_amount bigint,
    saved_amount  bigint,
    target_date   date,
    achieved_at   timestamptz
  )
  language sql
  stable
  security invoker
  set search_path to ''
as $function$
  -- SECURITY INVOKER on purpose: the caller's own RLS decides what they can see, so a
  -- non-member reads nothing through this instead of borrowing the definer's rights.
  select g.id,
         g.name,
         g.account_id,
         a.name,
         g.target_amount,
         coalesce(b.balance, 0)::bigint,
         g.target_date,
         g.achieved_at
  from   ez_finance.goals g
  join   ez_finance.accounts a on a.id = g.account_id
  left join lateral (
    select ab.balance
    from   ez_finance.account_balances(p_workspace_id) ab
    where  ab.account_id = g.account_id
  ) b on true
  where  g.workspace_id = p_workspace_id
  and    g.archived_at is null
  order by g.created_at;
$function$;

revoke execute on function ez_finance.goal_progress(uuid) from public, anon;
grant  execute on function ez_finance.goal_progress(uuid) to   authenticated;

commit;
