-- =============================================================================
-- Migration: make account-deletion finalization actually reachable
--
-- CORRECTION. The header of 20260725120000 claimed the private finalize helper
-- was "factored out so a future scheduled worker (edge cron, or pg_cron once
-- ez_finance graduates to its own project) can drive the same code path for
-- every due request". That claim was FALSE as shipped:
--
--   * ez_finance_private.finalize_deletion(uuid) had EXECUTE revoked from
--     PUBLIC and granted to nobody (ACL: postgres=X/postgres), so no role
--     outside the SECURITY DEFINER wrappers could reach it — not even
--     service_role.
--   * The only wrapper, ez_finance.process_deletion_if_due(), finalizes the
--     CALLER's own request and needs auth.uid(). But requesting deletion signs
--     the user out, so the common path (request and never come back) never
--     finalizes: the data is retained forever while the UI promises a date.
--
-- This migration closes the gap by adding the batch entry point that was
-- described but never written, plus the grant that makes the helper callable
-- out of band.
--
-- STILL NO SCHEDULED WORKER EXISTS. pg_cron and pg_net are NOT installed in
-- mvp-lab, so nothing in the database drives this on a timer. Something outside
-- Postgres (a Supabase Edge Function on a schedule, a CI job, an external cron)
-- must call ez_finance.process_due_deletions() with the service key. Until that
-- worker is deployed, finalization still only happens when the affected user
-- comes back and hits process_deletion_if_due(). This migration removes the
-- blocker; it does not remove the requirement.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. The escape hatch the previous migration claimed to have.
--    service_role is the only role that can reach the private helper directly;
--    anon/authenticated keep no access (PUBLIC was already revoked in
--    20260725120000 and is deliberately not re-granted).
-- ===========================================================================
grant execute on function ez_finance_private.finalize_deletion(uuid) to service_role;

-- ===========================================================================
-- 2. ez_finance.process_due_deletions(p_limit int default 100)
--    Batch finalization for an out-of-band worker. Returns how many requests
--    this call actually finalized.
--
--    WHY IT LIVES IN THE EXPOSED SCHEMA: PostgREST only routes to functions in
--    an exposed schema, and the intended caller is an Edge Function / external
--    cron hitting /rest/v1/rpc/process_due_deletions with the service key. The
--    usual "keep SECURITY DEFINER out of exposed schemas" rule is satisfied the
--    other way here: the function is revoked from public, anon AND
--    authenticated, so the only role that can route to it is service_role,
--    whose key never reaches a browser.
--
--    It deliberately does NOT read auth.uid(): a worker has no end-user
--    session, and that dependency is exactly what made finalization
--    unreachable in the first place.
--
--    The per-user advisory lock lives inside finalize_deletion(), so a batch
--    run and a returning user racing on the same request serialize correctly;
--    the loser simply finds nothing due and returns false.
-- ===========================================================================
create or replace function ez_finance.process_due_deletions(p_limit int default 100)
  returns int
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_limit     int := least(greatest(coalesce(p_limit, 100), 0), 1000);
  v_user_id   uuid;
  v_finalized int := 0;
begin
  -- Snapshot the batch first: finalize_deletion() stamps finalized_at, which
  -- would move a live cursor's window underneath us.
  for v_user_id in
    select user_id
    from   ez_finance_private.deletion_requests
    where  cancelled_at is null
    and    finalized_at is null
    and    ends_at      <= now()
    order  by ends_at
    limit  v_limit
  loop
    if ez_finance_private.finalize_deletion(v_user_id) then
      v_finalized := v_finalized + 1;
    end if;
  end loop;

  return v_finalized;
end;
$$;

-- ===========================================================================
-- 3. GRANTs — service_role only.
--    Both revokes are required: Postgres grants EXECUTE to PUBLIC on every new
--    function, and the ez_finance schema carries DEFAULT PRIVILEGES granting
--    all on routines to anon/authenticated/service_role (the fleet pattern).
--    Same reasoning as 20260725130000, one step stricter: `authenticated` has
--    no business finalizing OTHER users' accounts.
-- ===========================================================================
revoke execute on function ez_finance.process_due_deletions(int) from public, anon, authenticated;
grant  execute on function ez_finance.process_due_deletions(int) to service_role;

commit;
