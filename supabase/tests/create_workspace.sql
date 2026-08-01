-- Behavioural verification of ez_finance.create_workspace().
--
-- Everything that matters here lives inside a PL/pgSQL body or in a GRANT, and
-- `db reset` executes neither. The function writes MEMBERSHIP rows on a project whose
-- auth.users pool is shared with every other app in the fleet, so the checks below are
-- about who can reach it and what it refuses, not only about the happy path.
--
-- Fixture UUIDs use the f1/f2 range, disjoint from the other suites so the four can
-- run against one reset.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('f1111111-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wowner@test.local',   '', now(), now(), now()),
  ('f2222222-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wstranger@test.local', '', now(), now(), now());

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;
create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claims', '', false);
end;
$$;
create or replace function pg_temp.check(p_condition boolean, p_label text) returns void language plpgsql as $$
begin
  if p_condition then raise notice 'PASS: %', p_label;
  else raise exception 'FAIL: %', p_label; end if;
end;
$$;
create or replace function pg_temp.rejects(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then raise notice 'PASS: % (%)', p_label, sqlerrm; return;
  end;
  raise exception 'FAIL: % — the statement was ACCEPTED', p_label;
end;
$$;

-- ===========================================================================
-- 1. The grant. anon must not be able to REACH a function that writes membership.
--    The session_not_found guard inside the body would stop it anyway; that guard
--    is the second line of defence, and this asserts the first one exists.
-- ===========================================================================
select pg_temp.as_postgres();

select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.create_workspace(text)', 'execute'),
  'anon cannot execute create_workspace'
);

select pg_temp.check(
  has_function_privilege('authenticated', 'ez_finance.create_workspace(text)', 'execute'),
  'authenticated can execute create_workspace'
);

-- PUBLIC is the hole revoking from anon alone would leave open.
select pg_temp.check(
  not has_function_privilege('public', 'ez_finance.create_workspace(text)', 'execute'),
  'PUBLIC cannot execute create_workspace'
);

-- ===========================================================================
-- 2. No session is a refusal, not an anonymous workspace.
-- ===========================================================================
select pg_temp.as_anon();
select pg_temp.rejects(
  $$select ez_finance.create_workspace('Sin sesión')$$,
  'anon is refused'
);

-- THE PREVIOUS CHECK DOES NOT TEST THE BODY. It passes with "permission denied for
-- function", i.e. the GRANT stopped the call before a line of PL/pgSQL ran — which is
-- the outcome we want, and also means the session_not_found guard inside could be
-- deleted without that check noticing.
--
-- So: a caller that HAS execute privilege and NO sub claim. That is not a contrived
-- state — it is what a malformed or stripped JWT looks like, and user_id on
-- workspace_members is NULLABLE, so an unguarded body would happily create a workspace
-- owned by nobody.
create or replace function pg_temp.as_authenticated_without_sub() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

select pg_temp.as_authenticated_without_sub();
select pg_temp.rejects(
  $$select ez_finance.create_workspace('Sin sub')$$,
  'the body refuses a privileged caller whose JWT carries no sub'
);

-- ===========================================================================
-- 3. Name validation, inside the function rather than left to the column (the
--    column is plain `text not null`, so an empty string would otherwise pass).
-- ===========================================================================
select pg_temp.as_user('f1111111-0000-4000-8000-000000000001');

select pg_temp.rejects(
  $$select ez_finance.create_workspace('')$$,
  'an empty name is refused'
);
select pg_temp.rejects(
  $$select ez_finance.create_workspace('    ')$$,
  'a whitespace-only name is refused'
);
select pg_temp.rejects(
  $$select ez_finance.create_workspace(null)$$,
  'a null name is refused'
);
select pg_temp.rejects(
  format($$select ez_finance.create_workspace(%L)$$, repeat('a', 81)),
  'a name longer than 80 characters is refused'
);

-- ===========================================================================
-- 4. The happy path, and every property the app depends on.
-- ===========================================================================
select ez_finance.create_workspace('  Negocio  ') as created \gset

select pg_temp.as_postgres();

select pg_temp.check(
  (select name from ez_finance.workspaces where id = :'created') = 'Negocio',
  'the name is stored trimmed'
);

-- THE INVARIANT bootstrap() DEPENDS ON. It resolves the home workspace with
-- `where type = 'personal' ... limit 1`; a second personal row would make that
-- return an arbitrary one, silently, on every request.
select pg_temp.check(
  (select type from ez_finance.workspaces where id = :'created') = 'shared',
  'a created workspace is shared, never a second personal one'
);

select pg_temp.check(
  (select count(*) from ez_finance.workspace_members
   where workspace_id = :'created'
     and user_id = 'f1111111-0000-4000-8000-000000000001'
     and role = 'owner') = 1,
  'the caller is its owner'
);

select pg_temp.check(
  (select count(*) from ez_finance.workspace_members where workspace_id = :'created') = 1,
  'nobody else is added'
);

-- Same reason bootstrap() seeds: an expense with no category lands in NO bucket, so a
-- workspace without them has a 50/30/20 panel that can never fill.
select pg_temp.check(
  (select count(*) from ez_finance.categories where workspace_id = :'created') = 11,
  'the starter categories are seeded'
);

select pg_temp.check(
  (select base_currency is null from ez_finance.workspaces where id = :'created'),
  'base_currency starts NULL, adopted from the first account'
);

-- ===========================================================================
-- 5. RLS still applies to what the function created. A SECURITY DEFINER writer must
--    not become a way to publish rows to everyone.
-- ===========================================================================
select pg_temp.as_user('f2222222-0000-4000-8000-000000000002');

select pg_temp.check(
  (select count(*) from ez_finance.workspaces where id = :'created') = 0,
  'a stranger cannot see the created workspace'
);

select pg_temp.check(
  (select count(*) from ez_finance.categories where workspace_id = :'created') = 0,
  'a stranger cannot see its categories'
);

-- ===========================================================================
-- 6. The cap. A self-service creation path on a shared free-tier project needs a
--    ceiling: one retry loop would otherwise write unbounded rows into a database
--    every app in the fleet shares.
-- ===========================================================================
select pg_temp.as_user('f1111111-0000-4000-8000-000000000001');

-- One already exists from section 4, so nineteen more reaches the limit of twenty.
do $$
begin
  for i in 2..20 loop
    perform ez_finance.create_workspace('Espacio ' || i);
  end loop;
end;
$$;

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.workspace_members wm
   join ez_finance.workspaces w on w.id = wm.workspace_id
   where wm.user_id = 'f1111111-0000-4000-8000-000000000001'
     and wm.role = 'owner' and w.type = 'shared') = 20,
  'twenty owned workspaces are allowed'
);

select pg_temp.as_user('f1111111-0000-4000-8000-000000000001');
select pg_temp.rejects(
  $$select ez_finance.create_workspace('El veintiuno')$$,
  'the twenty-first is refused'
);

-- ===========================================================================
-- 7. The cap counts what you OWN, not what you belong to. Being invited into other
--    people's spaces must never exhaust your own allowance — a rule that matters
--    only once invitations exist, which is exactly when nobody will re-read this.
-- ===========================================================================
select pg_temp.as_postgres();

insert into ez_finance.workspaces (id, name, type)
values ('f3333333-0000-4000-8000-000000000003', 'Ajeno', 'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values ('f3333333-0000-4000-8000-000000000003',
        'f2222222-0000-4000-8000-000000000002', '', 'owner'),
       ('f3333333-0000-4000-8000-000000000003',
        'f1111111-0000-4000-8000-000000000001', '', 'member');

select pg_temp.check(
  (select count(*) from ez_finance.workspace_members
   where user_id = 'f1111111-0000-4000-8000-000000000001') = 21,
  'the user now belongs to twenty-one workspaces, owning twenty'
);

-- The stranger owns exactly one, so their allowance is untouched by the twenty above.
select pg_temp.as_user('f2222222-0000-4000-8000-000000000002');
select ez_finance.create_workspace('Mío propio') as second \gset

select pg_temp.check(
  :'second' is not null,
  'another user is unaffected by the first one reaching the cap'
);

select 'ALL CHECKS PASSED' as result;
