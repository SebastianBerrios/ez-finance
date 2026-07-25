-- =============================================================================
-- Migration: make the DELETED terminal state a PERSISTED fact
--
-- CORRECTION. Until now the app derived `DELETED` from the boolean returned by
-- ez_finance.process_deletion_if_due(), i.e. from "did THIS call erase the
-- data?". That is the wrong question, and it fails in both directions:
--
--   1. A Next.js prefetch render of the (app) layout consumes the sweep, gets
--      true, and emits a redirect the router discards. The real navigation then
--      gets false and bootstrap() silently re-provisions a fresh empty account.
--   2. Once a scheduled worker calls ez_finance.process_due_deletions() out of
--      band (the dominant path: the user requests deletion, is signed out, and
--      never comes back), the returning user's own sweep ALWAYS returns false.
--      The DELETED branch becomes unreachable BY DESIGN and every deleted user
--      is silently re-provisioned.
--
-- The fix is to record the fact and read it back:
--
--   * deletion_requests gains `acknowledged_at`. A request that is finalized
--     but NOT acknowledged means "this person has not yet been told".
--   * deletion_state() reports DELETED from that row, before GRACE_PERIOD /
--     ACTIVE, so ANY authenticated entry after finalization reaches the
--     terminal notice regardless of WHO finalized it.
--   * bootstrap() REFUSES to re-provision while such a row exists. Silent
--     re-provisioning is the bug, and a check inside bootstrap() is the only
--     place a caller cannot skip.
--   * acknowledge_deletion() stamps it, so a deliberate later sign-in can start
--     a fresh account. The app calls it from /auth/deleted, right before it
--     signs the user out.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. acknowledged_at
--    NULL on every existing row: a request finalized before this migration has
--    not been acknowledged either, so the next authenticated entry shows the
--    notice. That is the correct default — the alternative silently swallows
--    the only chance those users have of learning their data is gone.
-- ===========================================================================
alter table ez_finance_private.deletion_requests
  add column acknowledged_at timestamptz;

-- Every read below is "is there an unacknowledged finalization for this user?",
-- and it now runs on the hottest path in the app (the (app) layout).
create index deletion_requests_unacknowledged
  on ez_finance_private.deletion_requests (user_id)
  where finalized_at is not null and acknowledged_at is null;

-- ===========================================================================
-- 2. ez_finance.deletion_state()
--    Adds the terminal branch, ahead of GRACE_PERIOD / ACTIVE:
--      { "state": "DELETED", "finalized_at": ... }
--
--    Ordered by finalized_at desc because the ledger is append-only: a user who
--    deleted, acknowledged, started over and deleted again has more than one
--    finalized row, and only the unacknowledged one is news.
-- ===========================================================================
create or replace function ez_finance.deletion_state()
  returns jsonb
  language plpgsql
  security definer
  stable
  set search_path to ''
as $$
declare
  v_uid          uuid;
  v_finalized_at timestamptz;
  v_row          ez_finance_private.deletion_requests%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  select finalized_at
  into   v_finalized_at
  from   ez_finance_private.deletion_requests
  where  user_id         = v_uid
  and    finalized_at    is not null
  and    acknowledged_at is null
  order  by finalized_at desc
  limit  1;

  if v_finalized_at is not null then
    return jsonb_build_object(
      'state',        'DELETED',
      'finalized_at', v_finalized_at
    );
  end if;

  select *
  into   v_row
  from   ez_finance_private.deletion_requests
  where  user_id      = v_uid
  and    cancelled_at is null
  and    finalized_at is null
  limit  1;

  if not found then
    return jsonb_build_object('state', 'ACTIVE');
  end if;

  return jsonb_build_object(
    'state',        'GRACE_PERIOD',
    'requested_at', v_row.requested_at,
    'ends_at',      v_row.ends_at
  );
end;
$$;

-- ===========================================================================
-- 3. ez_finance.bootstrap()
--    Unchanged except for the refusal. The check sits AFTER the per-user
--    advisory lock, which finalize_deletion() takes too: a finalization racing
--    a bootstrap therefore serializes, and whichever runs second sees the
--    other's committed effect instead of both half-succeeding.
--
--    'account_deleted' is deliberately a distinct message so the adapter can
--    route it to the terminal notice rather than to a generic "unavailable".
-- ===========================================================================
create or replace function ez_finance.bootstrap()
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_uid          uuid;
  v_workspace_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'bootstrap() requires an authenticated session'
      using errcode = 'P0001';
  end if;

  -- Serialize per-user (transaction-scoped; released at commit).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text, 0)
  );

  -- Terminal state wins over everything: re-provisioning here would hand the
  -- user a working empty account with no hint that their data was destroyed,
  -- and would make the DELETED notice unreachable.
  if exists (
    select 1
    from   ez_finance_private.deletion_requests
    where  user_id         = v_uid
    and    finalized_at    is not null
    and    acknowledged_at is null
  ) then
    raise exception 'account_deleted' using errcode = 'P0001';
  end if;

  -- Idempotency (authoritative under the lock): already-bootstrapped user
  -- returns their existing, non-deleted Personal workspace.
  select wm.workspace_id
  into   v_workspace_id
  from   ez_finance.workspace_members wm
  join   ez_finance.workspaces        w on w.id = wm.workspace_id
  where  wm.user_id   = v_uid
  and    w.type       = 'personal'
  and    w.deleted_at is null
  limit  1;

  if v_workspace_id is not null then
    return v_workspace_id;
  end if;

  -- Ensure a profile exists (self-heals if a prior partial run left none).
  insert into ez_finance.profiles (id)
  values (v_uid)
  on conflict (id) do nothing;

  -- Create the Personal workspace + owner membership.
  insert into ez_finance.workspaces (name, type)
  values ('Personal', 'personal')
  returning id into v_workspace_id;

  insert into ez_finance.workspace_members
    (workspace_id, user_id, display_name_snapshot, role)
  values
    (v_workspace_id, v_uid, '', 'owner');

  return v_workspace_id;
end;
$$;

-- ===========================================================================
-- 4. ez_finance.acknowledge_deletion()
--    "I have seen the notice." Idempotent on purpose: the route handler that
--    calls it also signs the user out, and a retry after a partial failure must
--    not turn into a conflict.
-- ===========================================================================
create or replace function ez_finance.acknowledge_deletion()
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text, 0)
  );

  update ez_finance_private.deletion_requests
  set    acknowledged_at = now()
  where  user_id         = v_uid
  and    finalized_at    is not null
  and    acknowledged_at is null;
end;
$$;

-- ===========================================================================
-- 5. GRANTs
--    Postgres grants EXECUTE to PUBLIC on every NEW function, and the
--    ez_finance schema carries DEFAULT PRIVILEGES granting all on routines to
--    anon/authenticated/service_role (the fleet pattern). Revoking from `anon`
--    alone is NOT enough — the PUBLIC grant is a separate ACL entry, and that
--    exact trap already bit this schema once (see 20260725130000).
--
--    `create or replace` preserves the ACL of deletion_state() and bootstrap(),
--    so their existing grants survive; they are re-asserted for readability.
-- ===========================================================================
revoke execute on function ez_finance.acknowledge_deletion() from public, anon;
grant  execute on function ez_finance.acknowledge_deletion() to authenticated;

revoke execute on function ez_finance.deletion_state() from public, anon;
grant  execute on function ez_finance.deletion_state() to authenticated;
grant  execute on function ez_finance.bootstrap()      to authenticated;

commit;
