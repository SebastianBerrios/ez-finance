-- =============================================================================
-- Migration: ez_finance auth tables + bootstrap RPC
--
-- Creates the three core identity tables (profiles, workspaces,
-- workspace_members) with RLS, a shared updated_at trigger function, an
-- anti-recursion SECURITY DEFINER helper for the RLS policies, and the
-- idempotent bootstrap() RPC that REPLACES an auth.users INSERT trigger.
--
-- Why no auth.users trigger: mvp-lab is a SHARED project; auth.users is shared
-- across every app, and any `after insert on auth.users` trigger fires for ALL
-- apps' signups (fast_route already has one). ez_finance instead bootstraps via
-- an RPC the app calls once after the user's first login. It is idempotent and
-- race-safe (per-user advisory lock), so multiple/concurrent calls are safe.
--
-- Object ordering matters: SQL-language functions are validated at CREATE time
-- (check_function_bodies), so every table a function references must already
-- exist. Hence: tables first, then the helper, then the policies that use it.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. ez_finance_private.set_updated_at()
--    Generic BEFORE UPDATE trigger fn. SECURITY DEFINER + empty search_path so
--    it cannot be hijacked via search-path manipulation. No table refs, so it
--    is safe to define before any table exists.
-- ===========================================================================
create or replace function ez_finance_private.set_updated_at()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 2. ez_finance.profiles
--    One row per auth.users entry. Created ONLY by bootstrap() (SECURITY
--    DEFINER), never by a direct client INSERT. The client reads and patches
--    its own row via the RLS policies below.
-- ===========================================================================
create table ez_finance.profiles (
  id               uuid        primary key references auth.users(id) on delete cascade,
  display_name     text        not null default '',
  photo_url        text,
  -- BCP-47 language tag; 'es' matches the app's primary target market.
  language         text        not null default 'es',
  -- ISO 4217 three-letter currency code.
  default_currency char(3)     not null default 'USD',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table ez_finance.profiles enable row level security;

-- Read own profile.
create policy profiles_select_self
  on ez_finance.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- Update own profile (UPDATE needs both USING and WITH CHECK).
create policy profiles_update_self
  on ez_finance.profiles
  for update
  to authenticated
  using     ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No INSERT/DELETE client policy: bootstrap() (SECURITY DEFINER) inserts;
-- deletion cascades from auth.users.

create trigger profiles_set_updated_at
  before update on ez_finance.profiles
  for each row
  execute function ez_finance_private.set_updated_at();

-- ===========================================================================
-- 3. ez_finance.workspaces
--    Personal workspaces are created by bootstrap(). Shared-workspace CRUD is
--    Fase 3. No client write policy in this migration. (Policy defined in
--    section 5, after the helper exists.)
-- ===========================================================================
create table ez_finance.workspaces (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  -- 'personal' = single-user; 'shared' = multi-user (Fase 3).
  type        text        not null check (type in ('personal', 'shared')),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  -- Soft-delete for Fase 3 workspace lifecycle.
  deleted_at  timestamptz
);

alter table ez_finance.workspaces enable row level security;

-- ===========================================================================
-- 4. ez_finance.workspace_members
--    GOLDEN RULE table: user_id is nullable so membership records survive user
--    deletion (ON DELETE SET NULL). A surrogate PK (member_id) avoids the
--    nullable-column-in-PK problem. The partial unique index enforces one
--    membership per user per workspace while allowing multiple SET-NULL
--    tombstone rows ("Usuario eliminado" attribution via display_name_snapshot).
-- ===========================================================================
create table ez_finance.workspace_members (
  member_id             uuid        primary key default gen_random_uuid(),
  workspace_id          uuid        not null references ez_finance.workspaces(id) on delete cascade,
  -- Nullable: set to NULL when the auth.users row is deleted.
  user_id               uuid        references auth.users(id) on delete set null,
  -- Name snapshot at join time, for attribution after user_id becomes NULL.
  display_name_snapshot text,
  role                  text        not null check (role in ('owner', 'admin', 'member', 'observer')),
  joined_at             timestamptz not null default now()
);

create unique index workspace_members_user_workspace_unique
  on ez_finance.workspace_members (workspace_id, user_id)
  where user_id is not null;

alter table ez_finance.workspace_members enable row level security;

-- ===========================================================================
-- 5. ez_finance_private.workspace_ids_for_current_user()
--    SECURITY DEFINER helper returning the workspace_ids the caller belongs to.
--    Runs as owner (postgres) so it BYPASSES RLS on workspace_members, which is
--    what breaks the self-referential RLS recursion. Defined AFTER
--    workspace_members exists (SQL function bodies are validated at CREATE).
--    Not exposed to PostgREST (lives in ez_finance_private).
-- ===========================================================================
create or replace function ez_finance_private.workspace_ids_for_current_user()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path to ''
as $$
  select workspace_id
  from   ez_finance.workspace_members
  where  user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- 5a. workspaces SELECT policy — a user sees workspaces they belong to.
--     Uses the definer helper (not a direct workspace_members subquery) so the
--     visibility rule never depends on / recurses into workspace_members RLS.
-- ---------------------------------------------------------------------------
create policy workspaces_select_member
  on ez_finance.workspaces
  for select
  to authenticated
  using (id in (select ez_finance_private.workspace_ids_for_current_user()));

-- ---------------------------------------------------------------------------
-- 5b. workspace_members SELECT policy — a user sees their own membership rows
--     AND all rows in workspaces they belong to (so owners/admins can list
--     members). Branch (b) uses the definer helper to avoid RLS self-recursion.
-- ---------------------------------------------------------------------------
create policy workspace_members_select
  on ez_finance.workspace_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or workspace_id in (select ez_finance_private.workspace_ids_for_current_user())
  );

-- ===========================================================================
-- 6. ez_finance.bootstrap()
--    Idempotent, race-safe RPC. The app calls it once after first login. It
--    creates the profile, a Personal workspace, and the owner membership for
--    auth.uid(), and returns the Personal workspace id.
--
--    SECURITY DEFINER: required to INSERT into profiles/workspaces (no client
--    INSERT policy exists on them). set search_path to '' with fully-qualified
--    references prevents search-path hijacking.
--
--    RACE SAFETY: a per-user transaction advisory lock serializes concurrent
--    bootstrap() calls for the same user, so two near-simultaneous first-logins
--    cannot create two Personal workspaces. After acquiring the lock we re-check
--    for an existing Personal workspace, which is therefore authoritative.
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

-- App calls this RPC via PostgREST; SECURITY DEFINER bypasses RLS for its inserts.
grant execute on function ez_finance.bootstrap() to authenticated;

commit;
