-- =============================================================================
-- Migration: erase workspaces that a deletion leaves with no live members
--
-- CORRECTION to ez_finance_private.finalize_deletion() as shipped in
-- 20260725120000. Two defects, both of which leak rows into a shared 500 MB
-- database that nobody can ever see, reclaim or clean up:
--
--   1. SOLE-MEMBER PREDICATE COUNTED TOMBSTONES. Step (b) removed a personal
--      workspace only when `not exists (... m2.user_id is distinct from
--      p_user_id)`. A tombstone row (user_id IS NULL, left behind by an earlier
--      peer's deletion) satisfies `is distinct from`, so the predicate read it
--      as "another member is still here" and the workspace survived. A personal
--      workspace that ever contained a deleted peer was therefore never
--      removed. NULL is not a member; it is the absence of one.
--
--   2. SHARED WORKSPACES WERE NEVER CLEANED UP. Step (b) only ever considered
--      `type = 'personal'`. When the LAST live member of a shared workspace
--      deletes their account, every membership row is a tombstone and
--      ez_finance_private.workspace_ids_for_current_user() matches on
--      `user_id = auth.uid()`, so no session can ever resolve that workspace
--      again. The rows survive as invisible zombies.
--
-- Scope is deliberately narrow: only workspaces the deleted user actually
-- belonged to are considered. Sweeping every ownerless shared workspace in the
-- schema is a separate decision, tracked separately.
--
-- Everything else about the function is unchanged, including the golden rule:
-- auth.users is never touched, and shared workspaces that still have a live
-- member keep their tombstoned history for attribution.
-- =============================================================================

begin;

create or replace function ez_finance_private.finalize_deletion(p_user_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_request_id uuid;
  v_shared_ids uuid[];
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

  -- (b) remember the SHARED workspaces this user belongs to before step (d)
  --     tombstones the link. After `user_id -> NULL` there is no way left to
  --     tell which shared workspaces this deletion touched.
  select array_agg(distinct w.id)
  into   v_shared_ids
  from   ez_finance.workspaces w
  join   ez_finance.workspace_members m on m.workspace_id = w.id
  where  w.type    = 'shared'
  and    m.user_id = p_user_id;

  -- (c) sole-member personal workspaces are removed entirely.
  --     `m2.user_id is not null and m2.user_id <> p_user_id` — a tombstone is
  --     NOT another member, so it must not keep the workspace alive (defect 1).
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
           and    m2.user_id is not null
           and    m2.user_id <> p_user_id
         );

  -- (d) tombstone the rest (shared workspaces keep their history)
  update ez_finance.workspace_members
  set    user_id = null
  where  user_id = p_user_id;

  -- (e) a shared workspace whose last live member just left is unreachable
  --     forever — workspace_ids_for_current_user() resolves by user_id, and
  --     every row it has left is a tombstone. Erase it instead of orphaning it
  --     (defect 2). The cascade takes its membership rows with it.
  if v_shared_ids is not null then
    delete from ez_finance.workspaces w
    where  w.id = any(v_shared_ids)
    and    not exists (
             select 1
             from   ez_finance.workspace_members m
             where  m.workspace_id = w.id
             and    m.user_id is not null
           );
  end if;

  -- (f) erase the ez_finance identity
  delete from ez_finance.profiles
  where  id = p_user_id;

  -- (g) close the request
  update ez_finance_private.deletion_requests
  set    finalized_at = now()
  where  id = v_request_id;

  return true;
end;
$$;

-- `create or replace function` preserves the existing ACL, so the revoke from
-- PUBLIC (20260725120000) and the grant to service_role (20260725152455) both
-- survive. Re-asserted here so the intended grant state is readable in one
-- place and survives a re-run against a repaired database.
revoke execute on function ez_finance_private.finalize_deletion(uuid) from public;
grant  execute on function ez_finance_private.finalize_deletion(uuid) to service_role;

commit;
