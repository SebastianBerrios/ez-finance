-- =============================================================================
-- goal_progress() also returns when the goal STARTED.
--
-- WHY. Spec §5.8 asks for "el ritmo necesario (en camino / en riesgo)" and §5.11 for
-- an alert when "una meta está en riesgo". Neither is computable from what the
-- function returns today.
--
-- With target, saved and target_date you can work out how much per month is still
-- needed — but not whether the person is BEHIND. "Behind" is a comparison against a
-- baseline, and the only honest baseline available is the goal's own timeline: by the
-- time 60 % of the window has passed, roughly 60 % should be saved. Without a start
-- date the alternative is a rule with no evidence behind it — "at risk when the
-- deadline is within 30 days" would fire on a goal that is 99 % funded and stay
-- silent on one at 5 % with two months left.
--
-- created_at already exists on ez_finance.goals; the function orders by it and does
-- not return it. This exposes it, named started_at because that is what it means to
-- the caller — the column name is an implementation detail of the row.
--
-- DROP AND CREATE, not CREATE OR REPLACE. Postgres refuses to replace a function
-- whose OUT parameters change, and a RETURNS TABLE is OUT parameters. The drop is
-- safe: nothing holds a reference to it (no view, no policy, no other function), and
-- both statements are in the same transaction, so no window exists where the app
-- would find it missing.
--
-- The grants are re-asserted rather than assumed. A dropped function does not keep
-- them, and this is exactly the kind of implicit carry-over that lost bootstrap()'s
-- deletion guard in 20260728161500.
-- =============================================================================

begin;

drop function if exists ez_finance.goal_progress(uuid);

create function ez_finance.goal_progress(p_workspace_id uuid)
  returns table (
    id            uuid,
    name          text,
    account_id    uuid,
    account_name  text,
    target_amount bigint,
    saved_amount  bigint,
    target_date   date,
    achieved_at   timestamptz,
    started_at    timestamptz
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
         g.achieved_at,
         g.created_at
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
