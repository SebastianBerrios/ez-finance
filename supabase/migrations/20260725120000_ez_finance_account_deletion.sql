-- =============================================================================
-- Migration: ez_finance account deletion (30-day grace period), scoped
--
-- Adds the deletion-request ledger and the four RPCs that drive the account
-- lifecycle state machine (ACTIVE -> GRACE_PERIOD -> deleted data).
--
-- SCOPE RULE (mvp-lab is SHARED): this migration NEVER deletes the auth.users
-- row. auth.users is shared with fast_route/oasis, so removing it would destroy
-- another app's account. "Deleting an ez-finance account" therefore means:
-- erase the ez_finance profile + the user's sole-member personal workspaces,
-- and tombstone (user_id -> NULL) every remaining membership so shared history
-- and attribution survive (the golden rule, spec section 2).
--
-- NO pg_cron: pg_cron and pg_net are NOT installed in mvp-lab. Finalization is
-- therefore pull-based: the app calls ez_finance.process_deletion_if_due() on
-- authenticated entry. The private finalize helper is factored out so a future
-- scheduled worker (edge cron, or pg_cron once ez_finance graduates to its own
-- project) can drive the same code path for every due request.
--
-- The 30-day window is duplicated here and in the domain (GRACE_DAYS in
-- src/modules/auth/domain/grace-period.ts). The database value is
-- authoritative: it is what the RPCs return as ends_at.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. ez_finance_private.deletion_requests
--    Append-only ledger of deletion requests. Lives in the PRIVATE schema:
--    not exposed to the Data API, no grants to anon/authenticated. The only
--    way in is through the SECURITY DEFINER RPCs below.
--
--    A request is "pending" while cancelled_at IS NULL and finalized_at IS
--    NULL. The partial unique index makes at most one pending request per
--    user a database invariant (belt-and-braces with the advisory lock in
--    request_account_deletion()).
-- ===========================================================================
create table ez_finance_private.deletion_requests (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  ends_at      timestamptz not null,
  cancelled_at timestamptz,
  finalized_at timestamptz
);

create unique index deletion_requests_one_pending_per_user
  on ez_finance_private.deletion_requests (user_id)
  where cancelled_at is null and finalized_at is null;

-- Lookup index for the due-request scan (future scheduled worker).
create index deletion_requests_due
  on ez_finance_private.deletion_requests (ends_at)
  where cancelled_at is null and finalized_at is null;

-- RLS on with ZERO policies = deny-all for anon/authenticated. Access is
-- exclusively via the SECURITY DEFINER functions, which run as owner.
alter table ez_finance_private.deletion_requests enable row level security;

-- ===========================================================================
-- 2. ez_finance.deletion_state()
--    Returns the caller's lifecycle state as jsonb:
--      { "state": "ACTIVE" }
--      { "state": "GRACE_PERIOD", "requested_at": ..., "ends_at": ... }
--
--    Note an EXPIRED-but-not-yet-finalized request still reports GRACE_PERIOD
--    with ends_at in the past; the domain state machine rejects cancellation
--    in that case and process_deletion_if_due() closes it out.
-- ===========================================================================
create or replace function ez_finance.deletion_state()
  returns jsonb
  language plpgsql
  security definer
  stable
  set search_path to ''
as $$
declare
  v_uid uuid;
  v_row ez_finance_private.deletion_requests%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'session_not_found' using errcode = 'P0001';
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
-- 3. ez_finance.request_account_deletion()
--    ACTIVE -> GRACE_PERIOD. Idempotency is NOT desired here: requesting while
--    a request is already pending is a conflict (the domain state machine says
--    the transition is only valid from ACTIVE), surfaced as the generic
--    'conflict' message so the adapter maps it to ConflictOrRejected.
--
--    Race safety: per-user transaction advisory lock, same pattern as
--    ez_finance.bootstrap().
-- ===========================================================================
create or replace function ez_finance.request_account_deletion()
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_uid          uuid;
  v_requested_at timestamptz;
  v_ends_at      timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text, 0)
  );

  if exists (
    select 1
    from   ez_finance_private.deletion_requests
    where  user_id      = v_uid
    and    cancelled_at is null
    and    finalized_at is null
  ) then
    raise exception 'conflict' using errcode = 'P0001';
  end if;

  v_requested_at := now();
  v_ends_at      := v_requested_at + interval '30 days';

  insert into ez_finance_private.deletion_requests (user_id, requested_at, ends_at)
  values (v_uid, v_requested_at, v_ends_at);

  return jsonb_build_object(
    'requested_at', v_requested_at,
    'ends_at',      v_ends_at
  );
end;
$$;

-- ===========================================================================
-- 4. ez_finance.cancel_account_deletion()
--    GRACE_PERIOD -> ACTIVE. Only while the window is still open: once ends_at
--    has passed the request is due and cancellation is rejected ('conflict'),
--    mirroring cancelDeletion() in the domain state machine.
-- ===========================================================================
create or replace function ez_finance.cancel_account_deletion()
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
  set    cancelled_at = now()
  where  user_id      = v_uid
  and    cancelled_at is null
  and    finalized_at is null
  and    ends_at      > now();

  if not found then
    raise exception 'conflict' using errcode = 'P0001';
  end if;
end;
$$;

-- ===========================================================================
-- 5. ez_finance_private.finalize_deletion(p_user_id uuid)
--    The actual data erasure, scoped to ez_finance. Callable for ANY user id
--    so a future scheduled worker can finalize every due request; the public
--    wrapper below restricts it to the caller.
--
--    Order matters:
--      a) snapshot the display name into memberships that will be tombstoned,
--         so "Usuario eliminado" attribution keeps a human-readable name;
--      b) drop personal workspaces where this user is the ONLY member row
--         (cascade removes the membership);
--      c) tombstone every remaining membership (user_id -> NULL) — shared
--         workspaces and their history survive;
--      d) delete the profile;
--      e) stamp the request as finalized.
--    auth.users is deliberately untouched.
-- ===========================================================================
create or replace function ez_finance_private.finalize_deletion(p_user_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_request_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  -- Only a DUE, still-pending request finalizes.
  select id
  into   v_request_id
  from   ez_finance_private.deletion_requests
  where  user_id      = p_user_id
  and    cancelled_at is null
  and    finalized_at is null
  and    ends_at      <= now()
  limit  1;

  if v_request_id is null then
    return false;
  end if;

  -- (a) name snapshot for surviving membership rows.
  --     NULLIF/COALESCE are SQL constructs, not schema-qualifiable functions,
  --     so they are safe to use unqualified under `search_path to ''`.
  update ez_finance.workspace_members wm
  set    display_name_snapshot = p.display_name
  from   ez_finance.profiles p
  where  p.id       = p_user_id
  and    wm.user_id = p_user_id
  and    coalesce(wm.display_name_snapshot, '') = ''
  and    nullif(p.display_name, '') is not null;

  -- (b) sole-member personal workspaces are removed entirely
  delete from ez_finance.workspaces w
  where  w.type = 'personal'
  and    exists (
           select 1
           from   ez_finance.workspace_members m
           where  m.workspace_id = w.id
           and    m.user_id      = p_user_id
         )
  and    not exists (
           select 1
           from   ez_finance.workspace_members m2
           where  m2.workspace_id = w.id
           and    m2.user_id is distinct from p_user_id
         );

  -- (c) tombstone the rest (shared workspaces keep their history)
  update ez_finance.workspace_members
  set    user_id = null
  where  user_id = p_user_id;

  -- (d) erase the ez_finance identity
  delete from ez_finance.profiles
  where  id = p_user_id;

  -- (e) close the request
  update ez_finance_private.deletion_requests
  set    finalized_at = now()
  where  id = v_request_id;

  return true;
end;
$$;

-- ===========================================================================
-- 6. ez_finance.process_deletion_if_due()
--    Pull-based finalization for the CALLER only. The app invokes it on
--    authenticated entry (post-login bootstrap). Returns true when this call
--    performed the erasure.
-- ===========================================================================
create or replace function ez_finance.process_deletion_if_due()
  returns boolean
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

  return ez_finance_private.finalize_deletion(v_uid);
end;
$$;

-- ===========================================================================
-- 7. GRANTs
--    Only the four ez_finance wrappers are callable by the app. The private
--    helper stays ungranted: SECURITY DEFINER wrappers reach it, clients cannot.
-- ===========================================================================
grant execute on function ez_finance.deletion_state()           to authenticated;
grant execute on function ez_finance.request_account_deletion() to authenticated;
grant execute on function ez_finance.cancel_account_deletion()  to authenticated;
grant execute on function ez_finance.process_deletion_if_due()  to authenticated;

revoke execute on function ez_finance_private.finalize_deletion(uuid) from public;

commit;
