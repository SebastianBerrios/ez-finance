-- =============================================================================
-- Migration: harden ez_finance.process_due_deletions()
--
-- CORRECTION to 20260725152455. That migration shipped a SECURITY DEFINER
-- mass-erasure function in an API-EXPOSED schema whose only defence is a grant,
-- and deliberately no in-body check. Defects:
--
--   1. GRANT-ONLY DEFENCE. Step 5 of the fleet onboarding procedure in
--      D:\Programming\Frontend\CLAUDE.md prescribes
--      `grant all on routines in schema ez_finance to anon, authenticated,
--      service_role`. ONE re-run of that documented pattern hands the public
--      anon key a 1000-account erasure endpoint. That default already fired
--      once on this schema — it is why 20260725130000 exists. Defence in depth
--      belongs in the body too.
--   2. ONE POISON ROW FROZE THE PIPELINE. A single failing finalization aborted
--      the whole transaction, and because the driving select is ordered by
--      ends_at that row is FIRST on every subsequent run. Deletion stopped for
--      everybody, permanently and silently.
--   3. NO TOTAL ORDER AND NO PER-ROW ISOLATION. Concurrent or retrying workers
--      convoyed on the same rows, and `order by ends_at` alone is not a total
--      order so the batch boundary was nondeterministic between ties.
--   4. p_limit <= 0 CLAMPED TO ZERO. process_due_deletions(0) returned 0
--      forever and looked exactly like "nothing was due".
--   5. THE RESULT COULD NOT TELL "NOTHING WAS DUE" FROM "EVERYTHING FAILED".
--      The function returned only the finalized count and pushed the skipped
--      count to `raise warning`, which PostgREST does not surface. On a 30-day
--      retention promise that is the failure mode that matters.
--   6. INFRASTRUCTURE ERRORS WERE SWALLOWED. `exception when others` also
--      catches 57014 query_canceled (Supabase sets statement_timeout), 57P01,
--      40001 and 40P01. Once a statement timeout fires, every remaining
--      iteration is cancelled and counted as "skipped", and the call returns
--      success with zero finalizations.
--
-- =============================================================================
-- WHY THERE IS NO `FOR UPDATE SKIP LOCKED` HERE
--
-- An earlier draft of this file put `for update skip locked` on the driving
-- select. That INVERTS the lock order against the other code path and deadlocks:
--
--   worker: ROW lock (the cursor) -> ADVISORY lock (inside finalize_deletion)
--   user:   ADVISORY lock (finalize_deletion) -> ROW lock (the finalized_at
--           update at the very end of finalize_deletion)
--
--   ERROR:  deadlock detected
--   DETAIL: Process 410 waits for ShareLock on transaction 1597; blocked by 403.
--           Process 403 waits for ExclusiveLock on advisory lock [...]; by 410.
--   CONTEXT: while updating tuple (0,1) in relation "deletion_requests"
--
-- and defect 6 above made it INVISIBLE: the worker counted its own deadlock
-- victim as a skipped row and reported success.
--
-- The fix takes the ADVISORY lock FIRST on the worker side too, with
-- pg_try_advisory_xact_lock: same key, same order, both paths. The try variant
-- keeps exactly the property `skip locked` was added for — a user whose own
-- sweep is mid-flight, or a row another worker already claimed, is stepped over
-- instead of convoyed on — without ever blocking and without ever crossing.
-- A stepped-over row is reported as `contended`, NOT as `skipped`: it is not a
-- failure, it is someone else doing the same work, and the next run picks it up.
-- Dropping the row lock is safe because finalize_deletion() re-checks under the
-- advisory lock that the request is still pending and still due.
--
-- supabase/tests/deletion_deadlock.sql drives both interleavings through dblink
-- and asserts pg_stat_database.deadlocks does not move.
-- =============================================================================

begin;

-- The return type changes from int to jsonb, which `create or replace` cannot
-- do. Dropping also drops the ACL, so the grants at the bottom are load-bearing
-- rather than decorative.
drop function if exists ez_finance.process_due_deletions(int);

create function ez_finance.process_due_deletions(p_limit int default 100)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_claims    text;
  v_role      text;
  v_caller    text;
  v_limit     int;
  v_user_id   uuid;
  v_finalized int := 0;
  v_skipped   int := 0;
  v_contended int := 0;
begin
  -- -------------------------------------------------------------------------
  -- (1) In-body identity guard. Two legitimate callers:
  --       * a request carrying a service_role JWT (the Vercel cron route
  --         handler / an Edge Function hitting PostgREST with the secret key);
  --       * a direct owner connection with no JWT at all (psql, a migration,
  --         a maintenance script).
  --
  --     IT CHECKS THE CONNECTION IDENTITY, NOT THE PRESENCE OF A GUC. The
  --     previous version only ran the check when request.jwt.claims was
  --     non-empty, so a caller with NO claims — precisely what a re-run of the
  --     fleet onboarding grant would let through on a raw connection — walked
  --     straight past the guard it exists to enforce.
  --
  --     PostgREST connects as `authenticator` and issues `set local role
  --     <claims role>`, so an end-user request can never satisfy the owner
  --     branch: its session_user is authenticator and its effective role is
  --     anon/authenticated. Requiring BOTH to be an owner role also refuses a
  --     `set role authenticated` taken from an owner login. And the owner branch
  --     additionally requires the absence of claims: a GUC that says "I am an
  --     end user" is never ignored, it is grounds for refusal.
  --
  --     WHY NOT current_user: this function is SECURITY DEFINER, so inside the
  --     body current_user is always the OWNER — it can never identify the
  --     caller. The `role` GUC survives the switch and does: SET ROLE only
  --     succeeds for a role the session_user is actually a member of, so it is
  --     an authenticated fact, not a caller-supplied claim. It reads 'none'
  --     when the session never switched.
  --
  --     An effective role of service_role is accepted on its own because
  --     reaching that role already implies service_role privileges; that is how
  --     a direct `set role service_role` maintenance session drives the worker.
  --
  --     42501 = insufficient_privilege, the same SQLSTATE a missing grant
  --     raises, so a caller cannot tell the two refusals apart.
  -- -------------------------------------------------------------------------
  v_claims := pg_catalog.current_setting('request.jwt.claims', true);
  v_role   := case
                when v_claims is null or v_claims = '' then null
                else (v_claims::jsonb) ->> 'role'
              end;

  v_caller := pg_catalog.current_setting('role', true);
  if v_caller is null or v_caller = '' or v_caller = 'none' then
    v_caller := session_user::text;
  end if;

  -- `is not distinct from` and not `=`: with a NULL v_role the whole disjunction
  -- evaluates to NULL, `not NULL` is NULL, and `if NULL` does not fire — the
  -- caller would sail past the guard on exactly the no-claims path it is here
  -- to stop.
  if not (
       v_role   is not distinct from 'service_role'
    or v_caller = 'service_role'
    or (
         v_role is null
         and session_user in ('postgres', 'supabase_admin')
         and v_caller     in ('postgres', 'supabase_admin')
       )
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- -------------------------------------------------------------------------
  -- (2) p_limit <= 0 means "unspecified", not "do nothing".
  -- -------------------------------------------------------------------------
  if p_limit is null or p_limit <= 0 then
    v_limit := 100;
  else
    v_limit := least(p_limit, 1000);
  end if;

  -- -------------------------------------------------------------------------
  -- (3) The batch.
  --     `order by ends_at, user_id` is a TOTAL order, so the batch boundary is
  --     deterministic when several requests expire in the same instant.
  --
  --     Each finalization runs in its own subtransaction. Without that, one bad
  --     row aborts everything — and since it is also the OLDEST due row it is
  --     first in every later batch too, so the pipeline never recovers.
  --
  --     A skipped row is warned about, COUNTED, and returned to the caller, so
  --     the cron route can log it at error level and answer non-200. Its
  --     request stays pending, which is what makes it recoverable.
  -- -------------------------------------------------------------------------
  for v_user_id in
    select user_id
    from   ez_finance_private.deletion_requests
    where  cancelled_at is null
    and    finalized_at is null
    and    ends_at      <= now()
    order  by ends_at, user_id
    limit  v_limit
  loop
    -- ADVISORY LOCK FIRST — same key, same order as finalize_deletion(). See
    -- the header: taking a row lock before this one deadlocks against a
    -- returning user's own sweep.
    if not pg_catalog.pg_try_advisory_xact_lock(
             pg_catalog.hashtextextended(v_user_id::text, 0)
           ) then
      v_contended := v_contended + 1;
      continue;
    end if;

    begin
      if ez_finance_private.finalize_deletion(v_user_id) then
        v_finalized := v_finalized + 1;
      end if;
    exception
      -- Infrastructure, not data. A cancelled statement, a shutdown, a
      -- serialization failure or a deadlock says nothing about THIS row and
      -- will hit every remaining iteration too. Swallowing them turns a dead
      -- pipeline into a silent "finalized 0".
      when query_canceled
        or admin_shutdown
        or serialization_failure
        or deadlock_detected then
        raise;
      when others then
        v_skipped := v_skipped + 1;
        raise warning 'ez_finance.process_due_deletions: skipped user % (%: %)',
          v_user_id, sqlstate, sqlerrm;
    end;
  end loop;

  if v_skipped > 0 then
    raise warning 'ez_finance.process_due_deletions: % request(s) skipped this run', v_skipped;
  end if;

  return jsonb_build_object(
    'finalized', v_finalized,
    'skipped',   v_skipped,
    'contended', v_contended
  );
end;
$$;

-- Both revokes are required: PUBLIC is a separate ACL entry from anon, and the
-- ez_finance schema's DEFAULT PRIVILEGES keep handing routines to
-- anon/authenticated (the fleet pattern). The function was dropped above, so
-- these re-establish the intended state from scratch.
revoke execute on function ez_finance.process_due_deletions(int) from public, anon, authenticated;
grant  execute on function ez_finance.process_due_deletions(int) to service_role;

commit;
