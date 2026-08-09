-- The invariant, not the instances: NO function in ez_finance is executable by anon.
--
-- WHY THIS SUITE EXISTS. Three functions had drifted into being anon-callable, and each
-- arrived the same way: a migration wrote `grant execute ... to authenticated` and
-- nothing else, while Postgres had already granted EXECUTE to PUBLIC when the function
-- was created. The grant reads like the whole story and is half of it.
--
-- Fixing the three would have left the fourth to the next person and the Supabase
-- advisor to find it after a deploy. So this asserts the RULE instead, over every
-- function in the schema, present and future: a new one without the revoke fails here
-- rather than in production.
--
-- It is a GUARD suite: it inspects grants and creates no fixtures, so it needs no
-- workspace, no user and no cleanup.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_condition boolean, p_label text) returns void language plpgsql as $$
begin
  if p_condition then raise notice 'PASS: %', p_label;
  else raise exception 'FAIL: %', p_label; end if;
end;
$$;

-- ===========================================================================
-- 1. THE RULE. Every function in the API-exposed schema is unreachable by anon.
--
--    Reported by NAME when it fails, because "one function is wrong" is useless and
--    the fix is one revoke away once you know which.
-- ===========================================================================
do $$
declare
  v_leaky text;
begin
  select string_agg(
           p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
           ', ' order by p.proname
         )
  into   v_leaky
  from   pg_catalog.pg_proc p
  join   pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where  n.nspname = 'ez_finance'
  and    pg_catalog.has_function_privilege('anon', p.oid, 'execute');

  if v_leaky is null then
    raise notice 'PASS: no ez_finance function is executable by anon';
  else
    raise exception
      'FAIL: anon can execute these ez_finance functions — add `revoke execute on function <f> from public, anon;`: %',
      v_leaky;
  end if;
end
$$;

-- ===========================================================================
-- 2. The revoke did not take `authenticated` with it.
--
--    The failure mode of over-correcting: revoke from PUBLIC also removes the
--    privilege the app depends on unless a direct grant exists. Every function the
--    app calls by name is checked.
-- ===========================================================================
do $$
declare
  v_missing text;
  v_expected text[] := array[
    'bootstrap',
    'deletion_state',
    'request_account_deletion',
    'cancel_account_deletion',
    'process_deletion_if_due',
    'acknowledge_deletion',
    'create_workspace',
    'rename_workspace',
    'archive_workspace',
    'unarchive_workspace',
    'delete_workspace',
    'record_transfer',
    'delete_transfer',
    'account_balances',
    'budget_config_for',
    'goal_progress'
  ];
begin
  select string_agg(p.proname, ', ' order by p.proname)
  into   v_missing
  from   pg_catalog.pg_proc p
  join   pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where  n.nspname = 'ez_finance'
  and    p.proname = any(v_expected)
  and    not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute');

  if v_missing is null then
    raise notice 'PASS: every function the app calls is still executable by authenticated';
  else
    raise exception
      'FAIL: authenticated LOST execute on functions the app calls — the revoke went too far: %',
      v_missing;
  end if;
end
$$;

-- ===========================================================================
-- 3. The private helpers KEEP their grants, deliberately.
--
--    workspace_ids_for_current_user and its two siblings are called from inside RLS
--    POLICIES, which are evaluated as the role running the query. Take EXECUTE away
--    and an anon SELECT stops returning zero rows and starts raising "permission
--    denied for function" — an error where there used to be a clean empty result, and
--    a broken guard check in three other suites.
--
--    Asserted rather than left implicit, so a future tightening of the schema has to
--    argue with a test instead of discovering this in production.
-- ===========================================================================
select pg_temp.check(
  (select bool_and(pg_catalog.has_function_privilege('anon', p.oid, 'execute'))
   from   pg_catalog.pg_proc p
   join   pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where  n.nspname = 'ez_finance_private'
   and    p.proname in ('workspace_ids_for_current_user',
                        'managed_workspace_ids_for_current_user',
                        'transacting_workspace_ids_for_current_user')),
  'the RLS membership helpers stay executable by anon — a policy needs the querying role to run them'
);

-- And the schema they live in is not exposed over the API, which is what makes that
-- safe. Checked here because the previous assertion depends on it.
select pg_temp.check(
  not exists (
    select 1 from pg_catalog.pg_namespace
    where nspname = 'ez_finance_private'
    and   pg_catalog.has_schema_privilege('anon', oid, 'usage')
  ),
  'anon has no USAGE on ez_finance_private, so nothing in it is reachable over HTTP'
);

do $$ begin raise notice 'ALL GRANT CHECKS PASSED'; end $$;
