-- =============================================================================
-- Migration: least privilege for the account-deletion RPCs
--
-- The ez_finance schema was onboarded with `grant all on routines ... to anon,
-- authenticated, service_role` PLUS matching DEFAULT PRIVILEGES (the fleet
-- pattern in D:\Programming\Frontend\CLAUDE.md). That default silently handed
-- `anon` EXECUTE on the deletion RPCs added in 20260725120000.
--
-- Not exploitable as written — every one of those functions aborts with
-- 'session_not_found' when auth.uid() is null, and anon never carries a sub
-- claim. But they are SECURITY DEFINER functions that erase data, and the only
-- thing standing between the public anon key and that erasure would be a single
-- `if` inside each body. Defence in depth belongs at the grant, not in the
-- function: an anonymous caller should not be able to reach them at all.
--
-- Deliberately scoped to these four. Widening the revoke to every ez_finance
-- routine (bootstrap included) is a separate, fleet-wide decision.
-- =============================================================================

-- Both revokes are required. Postgres grants EXECUTE to PUBLIC on every new
-- function by default (visible as the `=X/postgres` entry in pg_proc.proacl),
-- so revoking from `anon` alone leaves the door open through PUBLIC. The
-- explicit grants to `authenticated` and `service_role` are untouched.
begin;

revoke execute on function ez_finance.deletion_state()           from public, anon;
revoke execute on function ez_finance.request_account_deletion() from public, anon;
revoke execute on function ez_finance.cancel_account_deletion()  from public, anon;
revoke execute on function ez_finance.process_deletion_if_due()  from public, anon;

-- Re-assert the intended callers, so the grant state is readable in one place
-- and survives a re-run of this migration against a repaired database.
grant execute on function ez_finance.deletion_state()           to authenticated;
grant execute on function ez_finance.request_account_deletion() to authenticated;
grant execute on function ez_finance.cancel_account_deletion()  to authenticated;
grant execute on function ez_finance.process_deletion_if_due()  to authenticated;

commit;
