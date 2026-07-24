-- =============================================================================
-- Migration: onboard ez_finance into the shared mvp-lab project
--
-- Creates the two app schemas, wires grants (mirroring fast_route exactly),
-- registers the exposed schema for auto-RLS, and exposes ez_finance to the
-- Data API by appending it to the authenticator role's pgrst.db_schemas list.
--
-- This file REPLACES the original rls_baseline.sql that mutated `public`
-- globally (revoke/grant/alter default privileges on public) — dangerous on a
-- shared project. ALL changes here are scoped to ez_finance / ez_finance_private
-- (plus the append-only auto-RLS registry row and the authenticator GUC).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Create app schemas.
--    ez_finance         -> exposed to the Data API (tables, enums, RPC)
--    ez_finance_private -> NOT exposed (SECURITY DEFINER trigger/helper fns)
-- ---------------------------------------------------------------------------
create schema if not exists ez_finance;
create schema if not exists ez_finance_private;

-- ---------------------------------------------------------------------------
-- 2. Grants for ez_finance (exposed schema). Mirror fast_route exactly.
--    RLS on individual tables is the real access gate; these grants only make
--    the schema reachable through PostgREST.
-- ---------------------------------------------------------------------------
grant usage on schema ez_finance to anon, authenticated, service_role;
grant all on all tables    in schema ez_finance to anon, authenticated, service_role;
grant all on all routines  in schema ez_finance to anon, authenticated, service_role;
grant all on all sequences in schema ez_finance to anon, authenticated, service_role;

-- Default privileges so every NEW object created in ez_finance by postgres
-- inherits the same grants (no need to repeat this per feature migration).
alter default privileges for role postgres in schema ez_finance
  grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema ez_finance
  grant all on routines  to anon, authenticated, service_role;
alter default privileges for role postgres in schema ez_finance
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Grants for ez_finance_private (NOT exposed).
--    Functions here are SECURITY DEFINER (run as owner). anon/authenticated
--    never get usage; service_role keeps usage for administrative access.
-- ---------------------------------------------------------------------------
grant usage on schema ez_finance_private to service_role;

-- ---------------------------------------------------------------------------
-- 4. Register ez_finance for auto-RLS (remote only).
--
--    public.rls_managed_schemas feeds the shared `ensure_rls` event trigger so
--    any table created in ez_finance automatically gets RLS enabled. That
--    registry is SHARED INFRA owned by fast_route's migrations — it exists on
--    the remote but NOT in a fresh local `db reset` of THIS repo (which only
--    replays ez_finance's own migrations). So the append-only insert is guarded
--    by an existence check: it registers on remote, and is skipped locally.
--    Skipping locally is safe because migration 2 enables RLS EXPLICITLY on
--    every table (we never rely on the auto-RLS net for correctness).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.rls_managed_schemas') is not null then
    insert into public.rls_managed_schemas (schema_name)
    values ('ez_finance')
    on conflict do nothing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Expose ez_finance to PostgREST (Data API).
--
--    `alter role authenticator set pgrst.db_schemas = '...'` REPLACES the whole
--    list, so we must APPEND ez_finance to whatever is already exposed rather
--    than hardcode a list. Hardcoding the remote list (public, graphql_public,
--    fast_route, oasis, ez_finance) breaks LOCAL PostgREST: fast_route/oasis do
--    not exist in a local `db reset`, so the schema cache fails to load (503).
--
--    So: read the authenticator role's CURRENT pgrst.db_schemas from
--    pg_roles.rolconfig (the migration runs as postgres, not authenticator, so
--    current_setting() would not reflect it), then append ez_finance only if
--    absent. Locally this yields e.g. "public, graphql_public, ez_finance";
--    on remote "public, graphql_public, fast_route, oasis, ez_finance". The
--    guard makes it idempotent.
--
--    Both reloads are required (OPERATIONS.md §Exposed schemas): reload config
--    picks up the new list; reload schema refreshes the table cache (without
--    it, requests fail with PGRST205 "Could not find the table ...").
-- ---------------------------------------------------------------------------
do $$
declare
  v_cfg     text[];
  v_entry   text;
  v_current text;
begin
  select rolconfig into v_cfg from pg_roles where rolname = 'authenticator';
  if v_cfg is not null then
    foreach v_entry in array v_cfg loop
      if v_entry like 'pgrst.db_schemas=%' then
        v_current := substring(v_entry from length('pgrst.db_schemas=') + 1);
      end if;
    end loop;
  end if;

  -- Fallback to the Supabase default exposed set if unset.
  if v_current is null or btrim(v_current) = '' then
    v_current := 'public, graphql_public';
  end if;

  if position('ez_finance' in v_current) = 0 then
    execute format(
      'alter role authenticator set pgrst.db_schemas = %L',
      v_current || ', ez_finance'
    );
  end if;
end
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

commit;
