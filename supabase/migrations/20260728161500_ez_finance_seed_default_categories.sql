-- =============================================================================
-- Migration: seed a starter category set when a workspace is created
--
-- Without categories the budget engine has nothing to bucket: an expense with no
-- categoryId is silently ignored by the classifier, so a brand-new workspace
-- would render a 50/30/20 dashboard of three empty buckets no matter how much
-- the person recorded. A starter set is what makes the app usable on first run.
--
-- Seeded here, inside bootstrap(), rather than by the app: bootstrap() already
-- owns "what a new workspace contains", it is SECURITY DEFINER (so it can insert
-- where the client has no policy), and it is already race-safe under a per-user
-- advisory lock. Doing it from the client would need a second round trip that
-- could fail after the workspace exists, leaving a workspace with no categories.
--
-- NO default ACCOUNT is seeded. An account carries a currency and an opening
-- balance, and the only currency available here is profiles.default_currency,
-- which defaults to 'USD' and is realistically never set at bootstrap time.
-- Guessing wrong is worse than an empty list, because the currency is immutable
-- afterwards — the person would have to notice, delete and recreate. Accounts get
-- a real creation path instead.
--
-- Categories are FLAT. The schema supports one level of nesting, but a starter
-- hierarchy imposes someone else's taxonomy; parents are worth creating once a
-- person has enough categories to want grouping.
--
-- Bucket assignments follow the canonical 50/30/20 reading, with one opinionated
-- call worth naming: "Deudas" sits in SAVE, because paying down debt beyond the
-- minimum is building net worth, not consumption. Anyone who disagrees can
-- archive it and make their own — the bucket is immutable by design, so this is
-- exactly the case archive-and-replace exists for.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. ez_finance_private.seed_default_categories(workspace_id)
--    Split out of bootstrap() so the list is readable and so a future
--    "restore defaults" action has something to call. Not exposed to PostgREST
--    (ez_finance_private), and takes the workspace explicitly rather than
--    reading auth.uid() — it is a helper, not an entry point.
-- ===========================================================================
create or replace function ez_finance_private.seed_default_categories(p_workspace_id uuid)
  returns void
  language sql
  security definer
  set search_path to ''
as $$
  insert into ez_finance.categories (workspace_id, name, bucket)
  values
    -- 50% — necesidades
    (p_workspace_id, 'Vivienda',      'need'),
    (p_workspace_id, 'Servicios',     'need'),
    (p_workspace_id, 'Supermercado',  'need'),
    (p_workspace_id, 'Transporte',    'need'),
    (p_workspace_id, 'Salud',         'need'),
    -- 30% — deseos
    (p_workspace_id, 'Salidas',       'want'),
    (p_workspace_id, 'Suscripciones', 'want'),
    (p_workspace_id, 'Ropa',          'want'),
    (p_workspace_id, 'Ocio',          'want'),
    -- 20% — ahorro
    (p_workspace_id, 'Ahorro',        'save'),
    (p_workspace_id, 'Deudas',        'save');
$$;

-- ===========================================================================
-- 2. bootstrap() — unchanged except for the seeding call.
--    Replaced wholesale because CREATE OR REPLACE FUNCTION has no way to patch a
--    body. The seed sits in the creation branch, AFTER the early return for an
--    already-bootstrapped user, so a second call never duplicates the set — and
--    a person who archived or renamed the defaults does not get them back.
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

  -- Starter categories, so the dashboard has something to bucket on day one.
  perform ez_finance_private.seed_default_categories(v_workspace_id);

  return v_workspace_id;
end;
$$;

grant execute on function ez_finance.bootstrap() to authenticated;

commit;
