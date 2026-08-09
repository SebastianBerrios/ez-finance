-- =============================================================================
-- Migration: rename, archive, unarchive and delete a workspace
--
-- ez_finance.workspaces has carried `archived_at` and `deleted_at` since
-- 20260724180001 and NOTHING has ever written them. The table has a SELECT policy
-- and nothing else, so spec §5.2's lifecycle — renombrar, archivar, desarchivar,
-- eliminar — had no path at all. This adds it.
--
-- WHY RPCs AND NOT AN UPDATE POLICY. The same reason create_workspace is an RPC
-- (20260801120000): mvp-lab shares ONE auth.users pool across the fleet, so
-- `authenticated` means "any user of any app", and the workspace tables are
-- deliberately writable only through SECURITY DEFINER functions that derive the
-- caller from auth.uid(). An UPDATE policy on workspaces would also be unable to
-- express the rules below — "only after archiving", "only with the exact name" —
-- because a policy is a row predicate, not a transition.
--
-- ARCHIVING HAS TO MEAN SOMETHING, and this is the load-bearing part of the
-- change. Spec §5.2: archiving "lo deja en solo lectura: preserva los reportes
-- históricos e impide registrar cosas nuevas", and §8 requires that recording a
-- transaction in an archived workspace "se bloquea con mensaje claro". Writing
-- archived_at alone would deliver none of that — every write policy in the schema
-- would keep accepting rows, and the flag would be decoration.
--
-- The whole schema already funnels write authorisation through exactly two
-- helpers, which is what makes this one small change instead of eleven:
--
--   managed_workspace_ids_for_current_user()     owner+admin → accounts,
--                                                categories, budget_configs, goals
--   transacting_workspace_ids_for_current_user() owner+admin+member → transactions,
--                                                scheduled_transactions
--
-- Adding `archived_at is null and deleted_at is null` to both turns every write
-- path in the app read-only at once, at the layer that cannot be bypassed. Reads
-- are untouched: workspace_ids_for_current_user() still resolves the space, so the
-- history and the reports stay visible, which is the point of archiving rather
-- than deleting.
--
-- The four RPCs below are SECURITY DEFINER and therefore unaffected by their own
-- restriction — otherwise archiving a workspace would make it impossible to
-- unarchive.
--
-- THE PERSONAL WORKSPACE IS NEITHER ARCHIVABLE NOR DELETABLE. It is bootstrap()'s
-- anchor, resolved with `where type = 'personal' and deleted_at is null`. Deleting
-- it would make the next sign-in silently create a SECOND personal workspace and
-- present it as home — the person's entire history replaced by an empty space that
-- looks correct. Archiving it would leave someone whose only space is read-only
-- with no way to record anything. Both are refused here rather than explained in a
-- UI that could be bypassed.
--
-- DELETE IS SOFT (deleted_at), not a DROP. Spec §3.4 archives rather than erases,
-- and physical erasure is reserved for account deletion, which already has its own
-- audited pipeline. From the person's side it is gone: it leaves the switcher, it
-- stops resolving, and it frees an allowance slot. What survives is recoverable by
-- support rather than by them, which is the correct asymmetry for an irreversible
-- button.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The two write helpers, now aware of the lifecycle.
--
--    Bodies replaced wholesale because a SQL function body cannot be patched —
--    and, as 20260728161500 proved by losing bootstrap()'s deletion guard while
--    claiming to be "unchanged except for the seeding call", a wholesale
--    replacement is where things go missing. So, explicitly: the only change to
--    either body is the join to workspaces and the two null checks. The role
--    filters are identical to 20260728143000 and 20260728174500.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.managed_workspace_ids_for_current_user()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path to ''
as $$
  select wm.workspace_id
  from   ez_finance.workspace_members wm
  join   ez_finance.workspaces        w on w.id = wm.workspace_id
  where  wm.user_id = (select auth.uid())
  and    wm.role in ('owner', 'admin')
  and    w.archived_at is null
  and    w.deleted_at  is null
$$;

create or replace function ez_finance_private.transacting_workspace_ids_for_current_user()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path to ''
as $$
  select wm.workspace_id
  from   ez_finance.workspace_members wm
  join   ez_finance.workspaces        w on w.id = wm.workspace_id
  where  wm.user_id = (select auth.uid())
  and    wm.role in ('owner', 'admin', 'member')
  and    w.archived_at is null
  and    w.deleted_at  is null
$$;

-- ---------------------------------------------------------------------------
-- 2. A private guard, so four functions cannot drift in what "the owner" means.
--
--    Returns the workspace row for the caller when they hold one of the given
--    roles, and raises otherwise. Raising rather than returning null keeps the
--    refusal in ONE place: a caller that forgot to check a null would proceed.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.workspace_for_role(
  p_workspace_id uuid,
  p_roles        text[]
)
  returns ez_finance.workspaces
  language plpgsql
  security definer
  stable
  set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws  ez_finance.workspaces;
begin
  if v_uid is null then
    raise exception 'session_not_found' using errcode = '42501';
  end if;

  select w.*
  into   v_ws
  from   ez_finance.workspaces        w
  join   ez_finance.workspace_members wm on wm.workspace_id = w.id
  where  w.id         = p_workspace_id
  and    wm.user_id   = v_uid
  and    wm.role      = any(p_roles)
  and    w.deleted_at is null;

  -- One message for "no such workspace", "not yours" and "wrong role". Telling
  -- them apart would let anyone probe which workspace ids exist.
  if v_ws.id is null then
    raise exception 'not_permitted' using errcode = '42501';
  end if;

  return v_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. rename_workspace — owner or admin.
--
--    Refused while archived, because archived means read-only and a name is
--    configuration. The rules mirror create_workspace exactly (btrim, non-empty,
--    at most 80) so the two cannot disagree about what a valid name is.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.rename_workspace(
  p_workspace_id uuid,
  p_name         text
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_ws   ez_finance.workspaces;
  v_name text := btrim(coalesce(p_name, ''));
begin
  v_ws := ez_finance_private.workspace_for_role(
    p_workspace_id, array['owner', 'admin']
  );

  if v_ws.archived_at is not null then
    raise exception 'workspace_archived' using errcode = '55000';
  end if;

  if length(v_name) = 0 then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;

  update ez_finance.workspaces
  set    name = v_name
  where  id = p_workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. archive_workspace — owner only (spec §4: "Archivar / eliminar el
--    workspace" is the owner's row).
-- ---------------------------------------------------------------------------
create or replace function ez_finance.archive_workspace(p_workspace_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_ws ez_finance.workspaces;
begin
  v_ws := ez_finance_private.workspace_for_role(p_workspace_id, array['owner']);

  -- See the header: this one is bootstrap()'s anchor.
  if v_ws.type = 'personal' then
    raise exception 'personal_workspace' using errcode = '55000';
  end if;

  -- Idempotent from the caller's side, but not silent: pressing archive twice is
  -- a stale screen, and re-stamping archived_at would move a date that other
  -- things may come to read.
  if v_ws.archived_at is not null then
    raise exception 'already_archived' using errcode = '55000';
  end if;

  update ez_finance.workspaces
  set    archived_at = now()
  where  id = p_workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. unarchive_workspace — owner only. The way back, and the reason archiving is
--    not a one-way door: spec §5.2 lists desarchivarlo in the same breath.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.unarchive_workspace(p_workspace_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_ws ez_finance.workspaces;
begin
  v_ws := ez_finance_private.workspace_for_role(p_workspace_id, array['owner']);

  if v_ws.archived_at is null then
    raise exception 'not_archived' using errcode = '55000';
  end if;

  update ez_finance.workspaces
  set    archived_at = null
  where  id = p_workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. delete_workspace — owner only, archived first, and the EXACT name typed
--    back (spec §5.2: "confirmar escribiendo su nombre exacto").
--
--    The name check is in the FUNCTION, not only in the form. A confirmation
--    that lives in the UI is a confirmation that a second client, a replayed
--    request or a future screen does not perform — and this is the one button in
--    the app that ends a workspace.
--
--    Compared after btrim on both sides, because the stored name is btrimmed at
--    write time and a trailing space someone cannot see must not be the reason
--    they cannot delete their own space. Case-SENSITIVE on purpose: "exacto"
--    means exact, and this is a deliberate speed bump.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.delete_workspace(
  p_workspace_id uuid,
  p_confirm_name text
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_ws ez_finance.workspaces;
begin
  v_ws := ez_finance_private.workspace_for_role(p_workspace_id, array['owner']);

  if v_ws.type = 'personal' then
    raise exception 'personal_workspace' using errcode = '55000';
  end if;

  if v_ws.archived_at is null then
    raise exception 'not_archived' using errcode = '55000';
  end if;

  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_ws.name) then
    raise exception 'name_mismatch' using errcode = '22023';
  end if;

  update ez_finance.workspaces
  set    deleted_at = now()
  where  id = p_workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. create_workspace: an ARCHIVED space no longer consumes the allowance.
--
--    Spec §6 says that on hitting the ceiling the app "ofrece archivar o eliminar
--    uno existente" — advice that does not work if archiving frees nothing. The
--    count already excluded deleted rows; archived ones were still counted
--    because, until this migration, archiving did not exist.
--
--    Replaced wholesale for the usual reason. The ONLY change to the body is
--    `and w.archived_at is null` in the count.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.create_workspace(p_name text)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid          uuid := (select auth.uid());
  v_name         text := btrim(coalesce(p_name, ''));
  v_owned        int;
  v_workspace_id uuid;
  c_max_owned    constant int := 20;
begin
  if v_uid is null then
    raise exception 'session_not_found' using errcode = '42501';
  end if;

  if length(v_name) = 0 then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;

  -- Counted over workspaces this user OWNS, not ones they belong to: being invited
  -- into other people's spaces must never exhaust your own allowance. Archived and
  -- deleted spaces are not counted — archiving is what the limit message tells you
  -- to do.
  select count(*)
  into   v_owned
  from   ez_finance.workspace_members wm
  join   ez_finance.workspaces        w on w.id = wm.workspace_id
  where  wm.user_id = v_uid
  and    wm.role    = 'owner'
  and    w.archived_at is null
  and    w.deleted_at  is null;

  if v_owned >= c_max_owned then
    raise exception 'workspace_limit_reached' using errcode = '54000';
  end if;

  insert into ez_finance.workspaces (name, type)
  values (v_name, 'shared')
  returning id into v_workspace_id;

  insert into ez_finance.workspace_members
    (workspace_id, user_id, display_name_snapshot, role)
  values
    (v_workspace_id, v_uid, '', 'owner');

  perform ez_finance_private.seed_default_categories(v_workspace_id);

  return v_workspace_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Least privilege at the grant, not only inside the bodies.
--
--    Postgres grants EXECUTE to PUBLIC on every new function, and ez_finance was
--    onboarded with `grant all on routines ... to anon, authenticated` plus
--    matching default privileges — so without the revokes the public anon key
--    could reach functions that end a workspace. The session_not_found guard
--    inside workspace_for_role would stop it; that guard is the second line of
--    defence, not the only one. Same reasoning as 20260725130000.
--
--    The ez_finance_private helpers are not exposed to PostgREST at all (that is
--    what the schema is for), and are revoked from the API roles regardless.
-- ---------------------------------------------------------------------------
revoke execute on function ez_finance.rename_workspace(uuid, text)    from public, anon;
revoke execute on function ez_finance.archive_workspace(uuid)         from public, anon;
revoke execute on function ez_finance.unarchive_workspace(uuid)       from public, anon;
revoke execute on function ez_finance.delete_workspace(uuid, text)    from public, anon;
revoke execute on function ez_finance.create_workspace(text)          from public, anon;

grant execute on function ez_finance.rename_workspace(uuid, text)  to authenticated;
grant execute on function ez_finance.archive_workspace(uuid)       to authenticated;
grant execute on function ez_finance.unarchive_workspace(uuid)     to authenticated;
grant execute on function ez_finance.delete_workspace(uuid, text)  to authenticated;
grant execute on function ez_finance.create_workspace(text)        to authenticated;

revoke execute on function ez_finance_private.workspace_for_role(uuid, text[])
  from public, anon, authenticated;

commit;
