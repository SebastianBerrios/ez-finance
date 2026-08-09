-- Behavioural verification of the workspace lifecycle RPCs.
--
-- THE CHECK WORTH READING FIRST is section 4: after archive_workspace(), every
-- write path in the app must refuse. That is not what archived_at says — it is what
-- the two write helpers say, and this migration changed them. A flag nobody reads
-- would pass a test that only asserted the flag, so the assertions here INSERT into
-- accounts, categories, budget_configs, goals, transactions and
-- scheduled_transactions and demand that each one fail.
--
-- The refusals arrive in two shapes and both appear below:
--   INSERT refused by a policy → RAISES (new row violates row-level security).
--   UPDATE/DELETE refused      → matches zero rows, raises NOTHING, so the
--                                assertion has to read the surviving row.
--
-- Fixture UUIDs use the f1/f2 range, disjoint from the other suites.
\set ON_ERROR_STOP on

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('f1111111-0000-4000-8000-000000000301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wowner@test.local',  '', now(), now(), now()),
  ('f2222222-0000-4000-8000-000000000302', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wadmin@test.local',  '', now(), now(), now()),
  ('f3333333-0000-4000-8000-000000000303', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wmember@test.local', '', now(), now(), now());

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
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

-- ---------------------------------------------------------------------------
-- Fixtures. The owner bootstraps (which creates their PERSONAL space, needed by
-- the personal-is-untouchable checks) and then creates a shared one through the
-- real RPC, so the lifecycle runs over a workspace built the way the app builds it.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select ez_finance.bootstrap();
select ez_finance.create_workspace('Casa') as ws \gset

select pg_temp.as_postgres();
insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  (:'ws', 'f2222222-0000-4000-8000-000000000302', '', 'admin'),
  (:'ws', 'f3333333-0000-4000-8000-000000000303', '', 'member');

insert into ez_finance.accounts (id, workspace_id, name, type, currency, initial_balance)
values ('f0000000-0000-4000-8000-00000000af01', :'ws', 'Efectivo', 'cash', 'PEN', 100000);

select pg_temp.check(
  (select count(*) from ez_finance.categories where workspace_id = :'ws') = 11,
  'create_workspace seeded the starter categories'
);

-- ===========================================================================
-- 1. rename_workspace: owner and admin may, a member may not.
-- ===========================================================================
select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select ez_finance.rename_workspace(:'ws', '  Casa Grande  ');

select pg_temp.as_postgres();
select pg_temp.check(
  (select name from ez_finance.workspaces where id = :'ws') = 'Casa Grande',
  'the owner renames, and the name is trimmed like create_workspace trims it'
);

select pg_temp.as_user('f2222222-0000-4000-8000-000000000302');
select ez_finance.rename_workspace(:'ws', 'Casa Admin');
select pg_temp.as_postgres();
select pg_temp.check(
  (select name from ez_finance.workspaces where id = :'ws') = 'Casa Admin',
  'an admin renames too (spec §4 puts configuration in the admin row)'
);

select pg_temp.as_user('f3333333-0000-4000-8000-000000000303');
select pg_temp.rejects(
  format($$select ez_finance.rename_workspace(%L, 'Casa Member')$$, :'ws'),
  'a member cannot rename'
);

select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select pg_temp.rejects(
  format($$select ez_finance.rename_workspace(%L, '   ')$$, :'ws'),
  'a blank name is refused'
);
select pg_temp.rejects(
  format($$select ez_finance.rename_workspace(%L, %L)$$, :'ws', repeat('x', 81)),
  'a name over 80 characters is refused, same ceiling as create_workspace'
);

-- A workspace that is not the caller's does not exist as far as the RPC is
-- concerned — same message as a wrong role, so ids cannot be probed.
select pg_temp.rejects(
  $$select ez_finance.rename_workspace('f0000000-0000-4000-8000-0000000000ff', 'X')$$,
  'a workspace the caller does not belong to is not_permitted, not "not found"'
);

-- ===========================================================================
-- 2. The PERSONAL workspace is neither archivable nor deletable.
--    bootstrap() resolves it with `type = 'personal' and deleted_at is null`;
--    deleting it would make the next sign-in create a second one and present it
--    as home, with the person's history replaced by an empty space.
-- ===========================================================================
select w.id as personal
from   ez_finance.workspaces        w
join   ez_finance.workspace_members wm on wm.workspace_id = w.id
where  wm.user_id = 'f1111111-0000-4000-8000-000000000301'
and    w.type = 'personal' \gset

select pg_temp.rejects(
  format($$select ez_finance.archive_workspace(%L)$$, :'personal'),
  'the personal workspace cannot be archived'
);
select pg_temp.rejects(
  format($$select ez_finance.delete_workspace(%L, 'Personal')$$, :'personal'),
  'nor deleted'
);

-- ===========================================================================
-- 3. archive_workspace: owner only, and not twice.
-- ===========================================================================
select pg_temp.as_user('f2222222-0000-4000-8000-000000000302');
select pg_temp.rejects(
  format($$select ez_finance.archive_workspace(%L)$$, :'ws'),
  'an ADMIN cannot archive — spec §4 puts that in the owner row alone'
);

select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select ez_finance.archive_workspace(:'ws');

select pg_temp.as_postgres();
select pg_temp.check(
  (select archived_at is not null from ez_finance.workspaces where id = :'ws'),
  'the owner archives'
);

select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select pg_temp.rejects(
  format($$select ez_finance.archive_workspace(%L)$$, :'ws'),
  'archiving twice is refused rather than re-stamping the date'
);

-- ===========================================================================
-- 4. ARCHIVED MEANS READ-ONLY. The section this migration exists for.
--
--    Every one of these is a real write through a real policy. archived_at by
--    itself would satisfy section 3 and none of this.
-- ===========================================================================
select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');

select pg_temp.rejects(
  format($$insert into ez_finance.accounts (workspace_id, name, type, currency, initial_balance)
           values (%L, 'Nueva', 'cash', 'PEN', 0)$$, :'ws'),
  'no new ACCOUNT in an archived workspace'
);

select pg_temp.rejects(
  format($$insert into ez_finance.categories (workspace_id, name, bucket)
           values (%L, 'Nueva', 'need')$$, :'ws'),
  'no new CATEGORY'
);

select pg_temp.rejects(
  format($$insert into ez_finance.budget_configs
             (workspace_id, effective_from, income_mode, expected_income, pct_need, pct_want, pct_save)
           values (%L, date_trunc('month', current_date)::date, 'mayor', 100000, 50, 30, 20)$$, :'ws'),
  'no new BUDGET'
);

select pg_temp.rejects(
  format($$insert into ez_finance.goals (workspace_id, name, account_id, target_amount)
           values (%L, 'Meta', 'f0000000-0000-4000-8000-00000000af01', 100000)$$, :'ws'),
  'no new GOAL'
);

select pg_temp.rejects(
  format($$insert into ez_finance.transactions
             (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
              exchange_rate, occurred_on, created_by)
           values (%L, 'f0000000-0000-4000-8000-00000000af01', 'expense', 1000, 1000, 'PEN', 1,
                   current_date, 'f1111111-0000-4000-8000-000000000301')$$, :'ws'),
  'no new TRANSACTION — spec §8, blocked rather than silently accepted'
);

select pg_temp.rejects(
  format($$select ez_finance.record_transfer(
             %L, 'f0000000-0000-4000-8000-00000000af01',
             'f0000000-0000-4000-8000-00000000af01', 100, 100, 'PEN', 1, current_date, null)$$, :'ws'),
  'nor a TRANSFER through the RPC'
);

-- Renaming is configuration, and configuration is a write.
select pg_temp.rejects(
  format($$select ez_finance.rename_workspace(%L, 'Otro nombre')$$, :'ws'),
  'an archived workspace cannot even be renamed'
);

-- READS SURVIVE, which is the entire difference between archiving and deleting.
-- Spec §5.2: "preserva los reportes históricos".
select pg_temp.check(
  (select count(*) from ez_finance.categories where workspace_id = :'ws') = 11,
  'the categories are still READABLE — history is preserved, not hidden'
);
select pg_temp.check(
  (select count(*) from ez_finance.accounts where workspace_id = :'ws') = 1,
  'and so is the account'
);
select pg_temp.check(
  (select count(*) from ez_finance.workspaces where id = :'ws') = 1,
  'and the workspace itself'
);

-- ===========================================================================
-- 5. An archived workspace frees an allowance slot (spec §6).
--    The limit message tells people to archive; that advice has to work.
-- ===========================================================================
select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*)
   from   ez_finance.workspace_members wm
   join   ez_finance.workspaces        w on w.id = wm.workspace_id
   where  wm.user_id = 'f1111111-0000-4000-8000-000000000301'
   and    wm.role = 'owner'
   and    w.archived_at is null
   and    w.deleted_at  is null) = 1,
  'the archived space is out of the owned-and-active count (only Personal remains)'
);

-- ===========================================================================
-- 6. unarchive_workspace puts everything back.
-- ===========================================================================
select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select ez_finance.unarchive_workspace(:'ws');

select pg_temp.as_postgres();
select pg_temp.check(
  (select archived_at is null from ez_finance.workspaces where id = :'ws'),
  'the owner unarchives — archiving is not a one-way door'
);

-- The write paths come back with it. This is the round trip, and without it the
-- helpers could be excluding the workspace for some other reason.
select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
insert into ez_finance.transactions
  (workspace_id, account_id, kind, base_amount, entered_amount, entered_currency,
   exchange_rate, occurred_on, created_by)
values
  (:'ws', 'f0000000-0000-4000-8000-00000000af01', 'expense', 2500, 2500, 'PEN', 1,
   current_date, 'f1111111-0000-4000-8000-000000000301');

select pg_temp.as_postgres();
select pg_temp.check(
  (select count(*) from ez_finance.transactions where workspace_id = :'ws') = 1,
  'and recording works again once it is unarchived'
);

select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select pg_temp.rejects(
  format($$select ez_finance.unarchive_workspace(%L)$$, :'ws'),
  'unarchiving something that is not archived is refused'
);

-- ===========================================================================
-- 7. delete_workspace: archived FIRST, then the EXACT name.
-- ===========================================================================
select pg_temp.rejects(
  format($$select ez_finance.delete_workspace(%L, 'Casa Admin')$$, :'ws'),
  'a workspace that is not archived cannot be deleted, correct name or not'
);

select ez_finance.archive_workspace(:'ws');

select pg_temp.rejects(
  format($$select ez_finance.delete_workspace(%L, 'casa admin')$$, :'ws'),
  'the name is case-SENSITIVE — "exacto" means exact'
);
select pg_temp.rejects(
  format($$select ez_finance.delete_workspace(%L, 'Casa')$$, :'ws'),
  'a partial name is refused'
);
select pg_temp.rejects(
  format($$select ez_finance.delete_workspace(%L, '')$$, :'ws'),
  'an empty confirmation is refused'
);

select pg_temp.as_user('f2222222-0000-4000-8000-000000000302');
select pg_temp.rejects(
  format($$select ez_finance.delete_workspace(%L, 'Casa Admin')$$, :'ws'),
  'an admin cannot delete, even with the right name'
);

-- Surrounding whitespace is forgiven: the stored name is btrimmed at write time,
-- so an invisible trailing space must not be why someone cannot delete their own
-- space.
select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select ez_finance.delete_workspace(:'ws', '  Casa Admin  ');

select pg_temp.as_postgres();
select pg_temp.check(
  (select deleted_at is not null from ez_finance.workspaces where id = :'ws'),
  'the owner deletes with the exact name (whitespace forgiven)'
);
select pg_temp.check(
  (select count(*) from ez_finance.transactions where workspace_id = :'ws') = 1,
  'the rows are still THERE — delete is soft, so support can recover it (spec §3.4)'
);

-- ===========================================================================
-- 8. A deleted workspace is gone as far as every RPC is concerned.
-- ===========================================================================
select pg_temp.as_user('f1111111-0000-4000-8000-000000000301');
select pg_temp.rejects(
  format($$select ez_finance.unarchive_workspace(%L)$$, :'ws'),
  'a deleted workspace cannot be unarchived back into existence'
);
select pg_temp.rejects(
  format($$select ez_finance.rename_workspace(%L, 'Zombi')$$, :'ws'),
  'nor renamed'
);
select pg_temp.rejects(
  format($$insert into ez_finance.categories (workspace_id, name, bucket)
           values (%L, 'Zombi', 'need')$$, :'ws'),
  'and it accepts no writes'
);

-- ===========================================================================
-- 9. Guards: the private helper is not reachable from the API roles.
-- ===========================================================================
-- As POSTGRES, and not as a detail. has_function_privilege() has to RESOLVE the
-- name before it can answer about it, and resolving it needs USAGE on
-- ez_finance_private — which `authenticated` does not have. Asked while
-- impersonating, the check dies with "permission denied for schema" instead of
-- returning false, which is a passing condition reported as an error.
select pg_temp.as_postgres();
select pg_temp.check(
  not has_function_privilege(
    'authenticated',
    'ez_finance_private.workspace_for_role(uuid, text[])',
    'execute'
  ),
  'workspace_for_role is not executable by authenticated'
);

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform set_config('role', 'anon', false);
end;
$$;
select pg_temp.as_anon();
select pg_temp.rejects(
  $$select ez_finance.archive_workspace('f0000000-0000-4000-8000-0000000000ff')$$,
  'anon cannot reach archive_workspace despite the schema-wide routine grants'
);
select pg_temp.as_postgres();

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
