-- =============================================================================
-- Migration: let a person create additional workspaces of their own
--
-- WHY THIS IS AN RPC AND NOT AN INSERT POLICY. ez_finance.workspaces and
-- ez_finance.workspace_members carry a SELECT policy and nothing else — no INSERT,
-- no UPDATE, no DELETE — and that is the workspace rule made structural:
--
--     "Membership must be an explicit row created by an admin / server-side path —
--      NEVER a self-insert RLS policy"   (D:\Programming\Frontend\CLAUDE.md §5)
--
-- mvp-lab shares ONE auth.users pool across every app, so `authenticated` means
-- "any user of any app". An INSERT policy on workspace_members, however carefully
-- written, is a self-insert path: it would let any authenticated request assert its
-- own membership. So the only writers are SECURITY DEFINER functions that derive the
-- user from auth.uid() and never take it as an argument. ez_finance.bootstrap() was
-- the first; this is the second.
--
-- WHY type = 'shared' AND NOT 'personal'. bootstrap() resolves the caller's home
-- workspace with `where type = 'personal' ... limit 1`. A second row of that type
-- would make that lookup return an arbitrary one of them, silently, forever — every
-- onboarding read and every fallback in the app depends on exactly one existing.
-- 'shared' is also what these are for: a workspace that can gain other members once
-- invitations exist. Until then it is simply a second space of your own.
--
-- The new workspace gets the starter categories, for the same reason bootstrap()
-- does: an expense with no category lands in NO bucket, so a workspace with none has
-- a 50/30/20 panel that cannot fill.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- A cap, and it is not decoration.
--
-- This is a self-service creation path on a shared free-tier project. Without a
-- ceiling, one loop — a retry storm, a stuck form, someone curious — writes
-- unbounded rows into a database every other app in the fleet shares. The number is
-- deliberately generous for a real person and useless for a script.
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
  -- No session, no caller to own the result. Same guard and same message as every
  -- other SECURITY DEFINER function in this schema.
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
  -- into other people's spaces must never exhaust your own allowance.
  select count(*)
  into   v_owned
  from   ez_finance.workspace_members wm
  join   ez_finance.workspaces        w on w.id = wm.workspace_id
  where  wm.user_id = v_uid
  and    wm.role    = 'owner'
  and    w.deleted_at is null;

  if v_owned >= c_max_owned then
    raise exception 'workspace_limit_reached' using errcode = '54000';
  end if;

  insert into ez_finance.workspaces (name, type)
  values (v_name, 'shared')
  returning id into v_workspace_id;

  -- The caller, as owner. user_id comes from auth.uid() and from nowhere else.
  insert into ez_finance.workspace_members
    (workspace_id, user_id, display_name_snapshot, role)
  values
    (v_workspace_id, v_uid, '', 'owner');

  -- Starter categories, so the new space can bucket something on day one.
  perform ez_finance_private.seed_default_categories(v_workspace_id);

  return v_workspace_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Least privilege at the grant, not only inside the body.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and the ez_finance
-- schema was onboarded with `grant all on routines ... to anon, authenticated,
-- service_role` plus matching DEFAULT PRIVILEGES — so without both revokes the
-- public anon key could reach a function that writes membership rows. The
-- session_not_found guard would stop it, but that guard should be the second line
-- of defence, not the only one. Same reasoning as 20260725130000.
-- ---------------------------------------------------------------------------
revoke execute on function ez_finance.create_workspace(text) from public, anon;
grant  execute on function ez_finance.create_workspace(text) to   authenticated;

commit;
