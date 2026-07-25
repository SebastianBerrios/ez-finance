-- =============================================================================
-- Migration: harden ez_finance.process_due_deletions()
--
-- CORRECTION to 20260725152455. That migration shipped a SECURITY DEFINER
-- mass-erasure function in an API-EXPOSED schema whose only defence is a grant,
-- and deliberately no in-body check. Four defects:
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
--   3. NO TOTAL ORDER AND NO SKIP LOCKED. Concurrent or retrying workers
--      convoyed on the same rows, and `order by ends_at` alone is not a total
--      order so the batch boundary was nondeterministic between ties.
--   4. p_limit <= 0 CLAMPED TO ZERO. process_due_deletions(0) returned 0
--      forever and looked exactly like "nothing was due".
-- =============================================================================

begin;

create or replace function ez_finance.process_due_deletions(p_limit int default 100)
  returns int
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_claims    text;
  v_role      text;
  v_limit     int;
  v_user_id   uuid;
  v_finalized int := 0;
  v_skipped   int := 0;
begin
  -- -------------------------------------------------------------------------
  -- (1) In-body role guard. Two legitimate callers:
  --       * a request carrying a service_role JWT (the Vercel cron route
  --         handler / an Edge Function hitting PostgREST with the secret key);
  --       * a direct owner connection with no JWT at all (psql, a migration,
  --         a maintenance script).
  --     Anything else is refused HERE, so a re-run of the fleet onboarding
  --     grant cannot turn this into an anon-callable erasure endpoint.
  --
  --     42501 = insufficient_privilege, the same SQLSTATE a missing grant
  --     raises, so a caller cannot tell the two refusals apart.
  -- -------------------------------------------------------------------------
  v_claims := pg_catalog.current_setting('request.jwt.claims', true);

  if v_claims is not null and v_claims <> '' then
    v_role := (v_claims::jsonb) ->> 'role';
    if v_role is distinct from 'service_role' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
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
  --     `for update skip locked` lets a second worker (or a retry of a run that
  --     is still in flight) pick up different rows instead of blocking on the
  --     first one's locks.
  --
  --     Each finalization runs in its own subtransaction. Without that, one bad
  --     row aborts everything — and since it is also the OLDEST due row it is
  --     first in every later batch too, so the pipeline never recovers. A
  --     skipped row is warned about and NOT counted; its request stays pending
  --     and an operator sees it accumulating.
  -- -------------------------------------------------------------------------
  for v_user_id in
    select user_id
    from   ez_finance_private.deletion_requests
    where  cancelled_at is null
    and    finalized_at is null
    and    ends_at      <= now()
    order  by ends_at, user_id
    limit  v_limit
    for update skip locked
  loop
    begin
      if ez_finance_private.finalize_deletion(v_user_id) then
        v_finalized := v_finalized + 1;
      end if;
    exception
      when others then
        v_skipped := v_skipped + 1;
        raise warning 'ez_finance.process_due_deletions: skipped user % (%: %)',
          v_user_id, sqlstate, sqlerrm;
    end;
  end loop;

  if v_skipped > 0 then
    raise warning 'ez_finance.process_due_deletions: % request(s) skipped this run', v_skipped;
  end if;

  return v_finalized;
end;
$$;

-- `create or replace function` preserves the existing ACL. Re-asserted so the
-- intended grant state is readable in one place and survives a re-run against a
-- repaired database. Both revokes are required: PUBLIC is a separate ACL entry
-- from anon, and the schema's DEFAULT PRIVILEGES keep handing routines to
-- anon/authenticated.
revoke execute on function ez_finance.process_due_deletions(int) from public, anon, authenticated;
grant  execute on function ez_finance.process_due_deletions(int) to service_role;

commit;
