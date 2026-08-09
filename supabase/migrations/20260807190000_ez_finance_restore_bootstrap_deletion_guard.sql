-- ===========================================================================
-- Restore the terminal-state guard that bootstrap() lost.
--
-- WHAT HAPPENED. 20260725164257 added a guard to ez_finance.bootstrap(): if the
-- caller has a deletion_request that is finalized but not acknowledged, raise
-- 'account_deleted' instead of provisioning anything. Its reason, verbatim from
-- that migration: "re-provisioning here would hand the user a working empty
-- account with no hint that their data was destroyed, and would make the DELETED
-- notice unreachable."
--
-- Three days later 20260728161500 replaced bootstrap() wholesale to add the
-- default-category seeding — CREATE OR REPLACE FUNCTION cannot patch a body, so
-- the whole thing had to be retyped. The guard did not come along. That
-- migration's own comment reads "bootstrap() — unchanged except for the seeding
-- call", which is what made the loss invisible: the comment asserted a fidelity
-- the body did not have.
--
-- HOW BAD. Not a user-visible bug in the dominant path, and worth being precise
-- about rather than alarming. bootstrapUserWorkspace() reads deletion_state()
-- BEFORE calling bootstrap() and returns DELETED from that, so a returning user
-- normally reaches the terminal notice from the application side.
--
-- The hole is the degraded path, and the application says so out loud. When the
-- deletion_state() read fails, src/modules/auth/infrastructure/bootstrap.ts
-- treats it as non-fatal with this justification: "ez_finance.bootstrap()
-- refuses on its own when the account was erased, so a failed read here cannot
-- resurrect it." That sentence stopped being true on 2026-07-28. With the guard
-- gone, a failed lifecycle read followed by bootstrap() silently re-provisions an
-- erased account: a working empty workspace, seeded categories, and no notice
-- that everything the person had is gone.
--
-- So this restores the defence the app is documented as relying on. Two layers
-- that agree, which is what the original design was.
--
-- WHY THE WHOLE BODY AGAIN. Same reason 20260728161500 had to: there is no way
-- to patch a function body. The body below is 20260728161500's, byte for byte,
-- with the guard block re-inserted in its original position — after the advisory
-- lock (so two concurrent entries cannot race past it) and before the idempotency
-- lookup (so an erased user is refused rather than handed a stale workspace).
--
-- The regression test that catches this lives in supabase/tests/
-- account_deletion.sql §19; it was failing before this migration and passes
-- after it.
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
  --
  -- Deliberately INSIDE the lock and BEFORE the idempotency lookup. Outside the
  -- lock two concurrent entries could both read "not finalized" and one could
  -- proceed; after the lookup, an erased user who still had a membership row
  -- would be handed it instead of being refused.
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

  -- Starter categories, so the dashboard has something to bucket on day one.
  perform ez_finance_private.seed_default_categories(v_workspace_id);

  return v_workspace_id;
end;
$$;

-- Re-asserted because a replaced function keeps its grants, but relying on that
-- across a wholesale replacement is how the guard went missing in the first
-- place: state nothing implicitly that the next person has to remember.
revoke execute on function ez_finance.bootstrap() from public, anon;
grant  execute on function ez_finance.bootstrap() to authenticated;
