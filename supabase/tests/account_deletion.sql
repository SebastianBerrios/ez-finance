-- Behavioural verification of the ez_finance account-deletion RPCs.
-- Runs as postgres but impersonates `authenticated` with JWT claims, which is
-- how the app actually reaches these functions.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures: two real auth.users rows (A deletes, B is a shared-workspace peer)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', '', now(), now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', '', now(), now(), now());

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
  if p_condition then
    raise notice 'PASS: %', p_label;
  else
    raise exception 'FAIL: %', p_label;
  end if;
end;
$$;

-- ===========================================================================
-- 1. Bootstrap both users, then build a SHARED workspace containing both.
-- ===========================================================================
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select ez_finance.bootstrap();
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
select ez_finance.bootstrap();
select pg_temp.as_postgres();

update ez_finance.profiles set display_name = 'Ana' where id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into ez_finance.workspaces (id, name, type)
values ('cccccccc-0000-4000-8000-000000000003', 'Casa', 'shared');

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', '', 'owner'),
  ('cccccccc-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'Beto', 'member');

-- ===========================================================================
-- 2. deletion_state() on a clean account reports ACTIVE.
-- ===========================================================================
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'ACTIVE',
  'clean account reports ACTIVE'
);

-- ===========================================================================
-- 3. request_account_deletion() opens a 30-day window.
-- ===========================================================================
-- NOTE: the result is captured into a variable first. `x BETWEEN a AND b`
-- expands to two comparisons, which would call this VOLATILE function twice
-- (the second call legitimately conflicting with the first).
do $$
declare
  v_window jsonb;
begin
  v_window := ez_finance.request_account_deletion();
  perform pg_temp.check(
    (v_window ->> 'ends_at')::timestamptz > now() + interval '29 days 23 hours'
      and (v_window ->> 'ends_at')::timestamptz < now() + interval '30 days 1 hour',
    'request opens a 30-day window'
  );
end;
$$;

select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'GRACE_PERIOD',
  'state reports GRACE_PERIOD after the request'
);

-- ===========================================================================
-- 4. A second request is a conflict (state machine: only valid from ACTIVE).
-- ===========================================================================
do $$
begin
  perform ez_finance.request_account_deletion();
  raise exception 'FAIL: a second request should have been rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'conflict' then
      raise notice 'PASS: second request rejected with conflict';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 5. A pending, not-yet-due request is NOT finalized.
-- ===========================================================================
select pg_temp.check(
  ez_finance.process_deletion_if_due() = false,
  'sweep leaves a not-yet-due request alone'
);
select pg_temp.check(
  exists (select 1 from ez_finance.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'profile survives while the window is open'
);

-- ===========================================================================
-- 6. cancel_account_deletion() returns the account to ACTIVE.
-- ===========================================================================
select ez_finance.cancel_account_deletion();
select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'ACTIVE',
  'cancel returns the account to ACTIVE'
);

-- ===========================================================================
-- 7. Cancelling with nothing pending is a conflict.
-- ===========================================================================
do $$
begin
  perform ez_finance.cancel_account_deletion();
  raise exception 'FAIL: cancel with nothing pending should be rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'conflict' then
      raise notice 'PASS: cancel with nothing pending rejected';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 8. Cancelling an EXPIRED window is a conflict (mirrors the domain guard).
-- ===========================================================================
select ez_finance.request_account_deletion();
select pg_temp.as_postgres();
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
and    cancelled_at is null and finalized_at is null;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');

do $$
begin
  perform ez_finance.cancel_account_deletion();
  raise exception 'FAIL: cancelling an expired window should be rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'conflict' then
      raise notice 'PASS: cancelling an expired window rejected';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 9. The sweep finalizes a DUE request — scoped erasure.
-- ===========================================================================
-- Capture A's personal workspace id BEFORE the sweep. Asserting "no personal
-- workspace joins to a member row with user_id = A" is vacuous: the sweep
-- tombstones every surviving membership (user_id -> NULL), so that join matches
-- nothing whether or not the workspace was deleted. Only the id proves erasure.
select pg_temp.as_postgres();
select w.id as a_personal_ws
from   ez_finance.workspaces w
join   ez_finance.workspace_members m on m.workspace_id = w.id
where  w.type    = 'personal'
and    m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
\gset
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');

select pg_temp.check(
  ez_finance.process_deletion_if_due() = true,
  'sweep finalizes a due request'
);

select pg_temp.as_postgres();

select pg_temp.check(
  not exists (select 1 from ez_finance.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'profile erased'
);

select pg_temp.check(
  not exists (select 1 from ez_finance.workspaces where id = :'a_personal_ws'),
  'personal workspace removed'
);

select pg_temp.check(
  exists (select 1 from ez_finance.workspaces where id = 'cccccccc-0000-4000-8000-000000000003'),
  'shared workspace survives'
);

select pg_temp.check(
  exists (
    select 1 from ez_finance.workspace_members
    where workspace_id = 'cccccccc-0000-4000-8000-000000000003'
    and   user_id is null
    and   display_name_snapshot = 'Ana'
  ),
  'shared membership tombstoned with the name snapshot'
);

select pg_temp.check(
  exists (
    select 1 from ez_finance.workspace_members
    where workspace_id = 'cccccccc-0000-4000-8000-000000000003'
    and   user_id = 'bbbbbbbb-0000-4000-8000-000000000002'
  ),
  'the other member is untouched'
);

select pg_temp.check(
  exists (select 1 from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'auth.users row is NEVER deleted (shared identity pool)'
);

select pg_temp.check(
  exists (
    select 1 from ez_finance_private.deletion_requests
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and finalized_at is not null
  ),
  'request stamped as finalized'
);

-- ===========================================================================
-- 10. The sweep is idempotent: a second run finds nothing due.
-- ===========================================================================
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.check(
  ez_finance.process_deletion_if_due() = false,
  'second sweep is a no-op'
);

-- ===========================================================================
-- 11. Peer B is completely unaffected.
-- ===========================================================================
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'ACTIVE',
  'peer account still ACTIVE'
);
select pg_temp.as_postgres();
select pg_temp.check(
  exists (select 1 from ez_finance.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'peer profile intact'
);

-- ===========================================================================
-- 12. Without a session every RPC refuses.
-- ===========================================================================
do $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'authenticated', false);
  perform ez_finance.deletion_state();
  raise exception 'FAIL: deletion_state without a session should be rejected';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'session_not_found' then
      raise notice 'PASS: anonymous call rejected with session_not_found';
    else
      raise exception 'FAIL: unexpected message %', sqlerrm;
    end if;
end;
$$;

-- ===========================================================================
-- 13. The private ledger and the finalize helper are unreachable from the app.
-- ===========================================================================
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');

do $$
begin
  perform 1 from ez_finance_private.deletion_requests;
  raise exception 'FAIL: authenticated must not read the deletion ledger';
exception
  when insufficient_privilege then
    raise notice 'PASS: deletion ledger is unreadable by authenticated';
end;
$$;

do $$
begin
  perform ez_finance_private.finalize_deletion('aaaaaaaa-0000-4000-8000-000000000001');
  raise exception 'FAIL: authenticated must not call finalize_deletion directly';
exception
  when insufficient_privilege then
    raise notice 'PASS: finalize_deletion is not callable by authenticated';
end;
$$;

-- ===========================================================================
-- 14. anon cannot reach the deletion RPCs at all (grant-level, not just the
--     in-function session guard). See 20260725130000.
-- ===========================================================================
select pg_temp.as_postgres();

select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.request_account_deletion()', 'execute')
  and not has_function_privilege('anon', 'ez_finance.cancel_account_deletion()', 'execute')
  and not has_function_privilege('anon', 'ez_finance.process_deletion_if_due()', 'execute')
  and not has_function_privilege('anon', 'ez_finance.deletion_state()', 'execute'),
  'anon has no EXECUTE on any deletion RPC'
);

select pg_temp.check(
  has_function_privilege('authenticated', 'ez_finance.request_account_deletion()', 'execute'),
  'authenticated keeps EXECUTE on the deletion RPCs'
);

-- ===========================================================================
-- 15. The out-of-band batch worker. See 20260725152455.
--
--     Fixtures: C is due, D is not due, E cancelled their request. None of
--     them is the caller — the batch RPC runs as service_role, which has no
--     auth.uid() at all. That is the whole point: the pull-based sweep can
--     never finalize the common case (request deletion, never come back).
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.local', '', now(), now(), now()),
  ('22222222-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@test.local', '', now(), now(), now()),
  ('33333333-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e@test.local', '', now(), now(), now());

create or replace function pg_temp.as_service_role() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'service_role', false);
end;
$$;

-- C: due request.
select pg_temp.as_user('11111111-0000-4000-8000-000000000011');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

-- D: pending but NOT due.
select pg_temp.as_user('22222222-0000-4000-8000-000000000012');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

-- E: requested, then cancelled.
select pg_temp.as_user('33333333-0000-4000-8000-000000000013');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();
select ez_finance.cancel_account_deletion();

select pg_temp.as_postgres();
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = '11111111-0000-4000-8000-000000000011'
and    cancelled_at is null and finalized_at is null;

-- E's cancelled request is backdated too: "cancelled" must beat "due".
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = '33333333-0000-4000-8000-000000000013';

select w.id as c_personal_ws
from   ez_finance.workspaces w
join   ez_finance.workspace_members m on m.workspace_id = w.id
where  w.type    = 'personal'
and    m.user_id = '11111111-0000-4000-8000-000000000011'
\gset

select pg_temp.as_service_role();
select pg_temp.check(
  ez_finance.process_due_deletions() = jsonb_build_object('finalized', 1, 'skipped', 0, 'contended', 0),
  'batch worker finalizes exactly the one DUE request and reports it'
);

select pg_temp.as_postgres();

select pg_temp.check(
  not exists (select 1 from ez_finance.profiles where id = '11111111-0000-4000-8000-000000000011'),
  'batch worker erased a profile it does not own the session of'
);
select pg_temp.check(
  not exists (select 1 from ez_finance.workspaces where id = :'c_personal_ws'),
  'batch worker removed the personal workspace of a non-caller'
);
select pg_temp.check(
  exists (select 1 from ez_finance.profiles where id = '22222222-0000-4000-8000-000000000012'),
  'batch worker skips a not-yet-due request'
);
select pg_temp.check(
  exists (select 1 from ez_finance.profiles where id = '33333333-0000-4000-8000-000000000013'),
  'batch worker skips a cancelled request'
);
select pg_temp.check(
  exists (select 1 from auth.users where id = '11111111-0000-4000-8000-000000000011'),
  'batch worker never deletes the shared auth.users row'
);

-- Idempotent: nothing left due.
select pg_temp.as_service_role();
select pg_temp.check(
  ez_finance.process_due_deletions() = jsonb_build_object('finalized', 0, 'skipped', 0, 'contended', 0),
  'a second batch run finalizes nothing'
);

-- ===========================================================================
-- 16. The batch worker is service_role ONLY. It finalizes arbitrary accounts
--     without a session, so authenticated reaching it would be a mass-deletion
--     primitive.
-- ===========================================================================
select pg_temp.as_postgres();

select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.process_due_deletions(int)', 'execute')
  and not has_function_privilege('authenticated', 'ez_finance.process_due_deletions(int)', 'execute'),
  'neither anon nor authenticated has EXECUTE on the batch worker'
);
select pg_temp.check(
  has_function_privilege('service_role', 'ez_finance.process_due_deletions(int)', 'execute'),
  'service_role can execute the batch worker'
);
select pg_temp.check(
  has_function_privilege('service_role', 'ez_finance_private.finalize_deletion(uuid)', 'execute'),
  'service_role can reach the private finalize helper (the documented escape hatch)'
);

select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
do $$
begin
  perform ez_finance.process_due_deletions();
  raise exception 'FAIL: authenticated must not run the batch worker';
exception
  when insufficient_privilege then
    raise notice 'PASS: batch worker is not callable by authenticated';
end;
$$;

-- ===========================================================================
-- 17. A tombstone is NOT another member. See 20260725152507, defect 1.
--     F's personal workspace also holds a NULL row left by an earlier peer
--     deletion; it must not keep the workspace alive.
-- ===========================================================================
select pg_temp.as_postgres();
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('44444444-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f@test.local', '', now(), now(), now());

select pg_temp.as_user('44444444-0000-4000-8000-000000000014');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

select pg_temp.as_postgres();
select w.id as f_personal_ws
from   ez_finance.workspaces w
join   ez_finance.workspace_members m on m.workspace_id = w.id
where  w.type    = 'personal'
and    m.user_id = '44444444-0000-4000-8000-000000000014'
\gset

insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values (:'f_personal_ws', null, 'Peer eliminado', 'member');

update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = '44444444-0000-4000-8000-000000000014'
and    cancelled_at is null and finalized_at is null;

select pg_temp.as_service_role();
select pg_temp.check(
  (ez_finance.process_due_deletions() ->> 'finalized')::int = 1,
  'batch worker finalizes F'
);

select pg_temp.as_postgres();
select pg_temp.check(
  not exists (select 1 from ez_finance.workspaces where id = :'f_personal_ws'),
  'personal workspace holding only a tombstone peer is removed'
);

-- ===========================================================================
-- 18. A shared workspace with no live members left is erased, not orphaned.
--     See 20260725152507, defect 2: workspace_ids_for_current_user() resolves
--     by user_id, so a tombstone-only workspace is unreachable forever.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('55555555-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h@test.local', '', now(), now(), now());

select pg_temp.as_user('55555555-0000-4000-8000-000000000015');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

select pg_temp.as_postgres();
insert into ez_finance.workspaces (id, name, type)
values ('dddddddd-0000-4000-8000-000000000004', 'Zombie', 'shared');
insert into ez_finance.workspace_members (workspace_id, user_id, display_name_snapshot, role)
values
  ('dddddddd-0000-4000-8000-000000000004', '55555555-0000-4000-8000-000000000015', 'Hugo', 'owner'),
  ('dddddddd-0000-4000-8000-000000000004', null, 'Peer eliminado', 'member');

update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = '55555555-0000-4000-8000-000000000015'
and    cancelled_at is null and finalized_at is null;

select pg_temp.as_service_role();
select pg_temp.check(
  (ez_finance.process_due_deletions() ->> 'finalized')::int = 1,
  'batch worker finalizes H'
);

select pg_temp.as_postgres();
select pg_temp.check(
  not exists (
    select 1 from ez_finance.workspaces
    where id = 'dddddddd-0000-4000-8000-000000000004'
  ),
  'shared workspace left with only tombstones is erased'
);
select pg_temp.check(
  not exists (
    select 1 from ez_finance.workspace_members
    where workspace_id = 'dddddddd-0000-4000-8000-000000000004'
  ),
  'its membership rows go with it'
);
select pg_temp.check(
  exists (select 1 from ez_finance.workspaces where id = 'cccccccc-0000-4000-8000-000000000003'),
  'a shared workspace that still has a live member is untouched'
);

-- ===========================================================================
-- 19. TERMINAL STATE IS PERSISTED, NOT "who ran the erasure".
--     C was finalized by the BATCH WORKER in section 15, out of band. C's own
--     sweep therefore returns false forever, so deriving DELETED from that
--     boolean makes the terminal notice unreachable and silently re-provisions
--     the account. deletion_state() must report it from the ledger instead.
--     See 20260725164257.
-- ===========================================================================
select pg_temp.as_user('11111111-0000-4000-8000-000000000011');

select pg_temp.check(
  ez_finance.process_deletion_if_due() = false,
  'the finalized user own sweep returns false (the batch worker got there first)'
);

select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'DELETED',
  'deletion_state reports DELETED after an out-of-band finalization'
);

select pg_temp.check(
  (ez_finance.deletion_state() ->> 'finalized_at') is not null,
  'the DELETED payload carries finalized_at'
);

-- bootstrap() must REFUSE while the erasure is unacknowledged. Silently
-- re-provisioning is the bug: the user gets a working empty account and no
-- hint that everything they had was destroyed.
--
-- The refusal is captured in a FLAG rather than asserted from the exception
-- handler. The earlier shape raised its own 'FAIL: bootstrap must refuse…' in the
-- body, and `raise exception` defaults to P0001 — the SAME sqlstate the handler
-- catches — so its own failure message came back as "unexpected message FAIL:
-- bootstrap must refuse…". The test worked; it just could not say which of the
-- two things had gone wrong. It is what 20260807190000 was diagnosed through, so
-- the next person gets to read it in one pass.
do $$
declare
  v_refused boolean := false;
  v_message text;
begin
  begin
    perform ez_finance.bootstrap();
  exception
    when sqlstate 'P0001' then
      v_refused := true;
      v_message := sqlerrm;
  end;

  if not v_refused then
    raise exception
      'FAIL: bootstrap RETURNED for an unacknowledged deletion instead of refusing';
  end if;

  if v_message <> 'account_deleted' then
    raise exception 'FAIL: bootstrap refused with the wrong message: %', v_message;
  end if;

  raise notice 'PASS: bootstrap refuses while the deletion is unacknowledged';
end;
$$;

select pg_temp.as_postgres();
select pg_temp.check(
  not exists (select 1 from ez_finance.profiles where id = '11111111-0000-4000-8000-000000000011'),
  'the refused bootstrap created no profile'
);

-- acknowledge_deletion() is the deliberate "I saw the notice" step. Only after
-- it does a later sign-in start a fresh account.
select pg_temp.as_user('11111111-0000-4000-8000-000000000011');
select ez_finance.acknowledge_deletion();

select pg_temp.check(
  (ez_finance.deletion_state() ->> 'state') = 'ACTIVE',
  'acknowledging the deletion clears the terminal state'
);

select pg_temp.check(
  ez_finance.bootstrap() is not null,
  'bootstrap works again once the deletion is acknowledged'
);

-- Idempotent: the route handler may retry it.
select ez_finance.acknowledge_deletion();

select pg_temp.as_postgres();
select pg_temp.check(
  not has_function_privilege('anon', 'ez_finance.acknowledge_deletion()', 'execute')
  and has_function_privilege('authenticated', 'ez_finance.acknowledge_deletion()', 'execute'),
  'acknowledge_deletion is authenticated-only'
);

-- ===========================================================================
-- 20. p_limit actually bounds the batch. See 20260725164259.
-- ===========================================================================
-- FIVE due requests, not three. `process_due_deletions(2)` then leaves THREE
-- behind, so the follow-up assertion distinguishes "p_limit 0 fell back to the
-- default" from "p_limit 0 fell back to any positive number" — with a single
-- leftover row the check passed for a fallback of 1 too.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('66666666-0000-4000-8000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'i@test.local', '', now(), now(), now()),
  ('77777777-0000-4000-8000-000000000017', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'j@test.local', '', now(), now(), now()),
  ('88888888-0000-4000-8000-000000000018', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'k@test.local', '', now(), now(), now()),
  ('99999999-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'l@test.local', '', now(), now(), now()),
  ('99999999-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm@test.local', '', now(), now(), now());

select pg_temp.as_user('66666666-0000-4000-8000-000000000016');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();
select pg_temp.as_user('77777777-0000-4000-8000-000000000017');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();
select pg_temp.as_user('88888888-0000-4000-8000-000000000018');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();
select pg_temp.as_user('99999999-0000-4000-8000-000000000021');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();
select pg_temp.as_user('99999999-0000-4000-8000-000000000022');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

select pg_temp.as_postgres();
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id in (
  '66666666-0000-4000-8000-000000000016',
  '77777777-0000-4000-8000-000000000017',
  '88888888-0000-4000-8000-000000000018',
  '99999999-0000-4000-8000-000000000021',
  '99999999-0000-4000-8000-000000000022'
)
and    cancelled_at is null and finalized_at is null;

select pg_temp.as_service_role();
select pg_temp.check(
  (ez_finance.process_due_deletions(2) ->> 'finalized')::int = 2,
  'p_limit bounds the batch to two requests'
);

-- p_limit <= 0 means "unspecified", NOT "do nothing". Clamping to zero made
-- process_due_deletions(0) return 0 forever and look like "nothing was due".
select pg_temp.check(
  (ez_finance.process_due_deletions(0) ->> 'finalized')::int = 3,
  'p_limit 0 falls back to the default and drains all three leftovers'
);

-- ===========================================================================
-- 21. A POISON ROW MUST NOT FREEZE THE PIPELINE.
--     The driving select is ordered by ends_at, so a row that always fails is
--     first on every subsequent run. Without per-row exception handling one bad
--     row aborts the whole transaction and deletion stops for everybody,
--     permanently. See 20260725164259.
-- ===========================================================================
select pg_temp.as_postgres();
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('99999999-0000-4000-8000-000000000019', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'poison@test.local', '', now(), now(), now()),
  ('aaaaaaaa-0000-4000-8000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'healthy@test.local', '', now(), now(), now());

select pg_temp.as_user('99999999-0000-4000-8000-000000000019');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000020');
select ez_finance.bootstrap();
select ez_finance.request_account_deletion();

select pg_temp.as_postgres();
-- The poison row is the OLDEST due request, so it is first in every batch.
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '10 minutes'
where  user_id = '99999999-0000-4000-8000-000000000019'
and    cancelled_at is null and finalized_at is null;
update ez_finance_private.deletion_requests
set    ends_at = now() - interval '1 second'
where  user_id = 'aaaaaaaa-0000-4000-8000-000000000020'
and    cancelled_at is null and finalized_at is null;

-- Simulate an erasure that always fails for one user (an FK, a broken trigger,
-- a constraint added later — the cause does not matter, the blast radius does).
create function public.ez_finance_test_poison() returns trigger
  language plpgsql as $$
begin
  if old.id = '99999999-0000-4000-8000-000000000019' then
    raise exception 'poison row';
  end if;
  return old;
end;
$$;
create trigger ez_finance_test_poison
  before delete on ez_finance.profiles
  for each row execute function public.ez_finance_test_poison();

select pg_temp.as_service_role();
select pg_temp.check(
  ez_finance.process_due_deletions() = jsonb_build_object('finalized', 1, 'skipped', 1, 'contended', 0),
  'a poison row is skipped, REPORTED, and the rest of the batch still finalizes'
);

select pg_temp.as_postgres();
select pg_temp.check(
  not exists (select 1 from ez_finance.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000020'),
  'the healthy request behind the poison row was finalized'
);
select pg_temp.check(
  exists (select 1 from ez_finance.profiles where id = '99999999-0000-4000-8000-000000000019'),
  'the poison request was left pending, not counted'
);

drop trigger ez_finance_test_poison on ez_finance.profiles;
drop function public.ez_finance_test_poison();

-- ===========================================================================
-- 22. The batch worker refuses any caller that is not service_role, IN THE
--     BODY — not only at the grant. One re-run of the fleet onboarding step
--     ("grant all on routines in schema ez_finance to anon, authenticated,
--     service_role") would otherwise hand the public anon key a 1000-account
--     erasure endpoint. That default already fired once on this schema.
--
--     So this section RE-RUNS THAT EXACT GRANT first. Without it every refusal
--     below comes from the missing EXECUTE privilege and the body guard is
--     never reached — the grant, not the guard, is what the assertions would be
--     pinning.
-- ===========================================================================
select pg_temp.as_postgres();

grant execute on function ez_finance.process_due_deletions(int) to anon, authenticated;

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000001', 'role', 'authenticated')::text, false);
  perform ez_finance.process_due_deletions();
  raise exception 'FAIL: an authenticated JWT must not run the batch worker';
exception
  when insufficient_privilege then
    raise notice 'PASS: authenticated JWT refused in the function body';
end;
$$;

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  perform ez_finance.process_due_deletions();
  raise exception 'FAIL: an anon JWT must not run the batch worker';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon JWT refused in the function body';
end;
$$;

-- THE CASE THE OLD GUARD SKIPPED ENTIRELY. It only ran the role check when
-- request.jwt.claims was non-empty, so a caller with NO claims — exactly what a
-- raw connection reaching the re-granted function looks like — walked straight
-- through the defence-in-depth check.
do $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'authenticated', false);
  perform ez_finance.process_due_deletions();
  raise exception 'FAIL: `set role authenticated` with no claims must not run the batch worker';
exception
  when insufficient_privilege then
    raise notice 'PASS: role authenticated with NO claims refused in the function body';
end;
$$;

do $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'anon', false);
  perform ez_finance.process_due_deletions();
  raise exception 'FAIL: `set role anon` with no claims must not run the batch worker';
exception
  when insufficient_privilege then
    raise notice 'PASS: role anon with NO claims refused in the function body';
end;
$$;

select pg_temp.as_postgres();
revoke execute on function ez_finance.process_due_deletions(int) from anon, authenticated;

-- A service_role JWT is accepted (this is the Edge Function / cron caller).
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
  perform ez_finance.process_due_deletions();
  raise notice 'PASS: a service_role JWT is accepted';
end;
$$;

-- A direct owner connection with no JWT at all is accepted (psql, a migration,
-- a maintenance script).
select pg_temp.as_postgres();
select pg_temp.check(
  (ez_finance.process_due_deletions() ->> 'finalized')::int = 0,
  'a direct owner connection with no claims is accepted'
);

select pg_temp.as_postgres();

\echo 'ALL CHECKS PASSED'
