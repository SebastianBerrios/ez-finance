-- =============================================================================
-- Take EXECUTE away from anon on the three ez_finance functions that still had it.
--
-- FOUND BY THE SUPABASE SECURITY ADVISOR after the last deploy, which reports
-- `record_transfer` and `delete_transfer` as callable by the `anon` role over
-- /rest/v1/rpc/. A query for every anon-executable function in the schema turned up a
-- third, `account_balances`.
--
-- THE CAUSE IS ALWAYS THE SAME. Postgres grants EXECUTE to PUBLIC on every new
-- function, and this schema was onboarded with `grant all on routines ... to anon,
-- authenticated, service_role` plus matching default privileges. So a migration that
-- writes only `grant execute ... to authenticated` — which is what 20260728174500 and
-- 20260728231500 did — leaves anon holding the privilege it was born with. The grant
-- reads like the whole story and is only half of it.
--
-- HOW BAD, precisely: not an open door. record_transfer and delete_transfer are
-- SECURITY DEFINER but re-derive the caller from auth.uid() and re-check membership
-- themselves, so an anon call finds no membership and is refused. account_balances is
-- SECURITY INVOKER, so anon's own RLS returns nothing. What was missing is the layer
-- BEFORE those checks — and a guard that is the only guard is a guard one refactor
-- away from being none.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH: ez_finance_private.
--
-- Fifteen functions there are also anon-executable, and revoking that would be a
-- mistake rather than a tightening. Three of them —
-- workspace_ids_for_current_user, managed_workspace_ids_for_current_user and
-- transacting_workspace_ids_for_current_user — are called from inside RLS POLICIES,
-- which are evaluated as the role running the query. An anon SELECT against
-- ez_finance.transactions today evaluates the helper and gets zero rows; without
-- EXECUTE it would get "permission denied for function" instead. That turns a clean
-- empty result on a public endpoint into an error, and it would break the guard checks
-- in the suites that assert anon reads nothing.
--
-- The rest are trigger functions, which do not need the invoking role to hold EXECUTE
-- at all. And the schema is not in the exposed API list, so none of them is reachable
-- over HTTP regardless. Left alone on purpose, with the reason written down.
-- =============================================================================

begin;

-- SECURITY DEFINER, and the pair that owns the "both legs or neither" invariant.
revoke execute on function ez_finance.record_transfer(
  uuid, uuid, uuid, bigint, bigint, char, numeric, date, text
) from public, anon;

revoke execute on function ez_finance.delete_transfer(uuid) from public, anon;

-- SECURITY INVOKER, so RLS already answered anon with nothing. Revoked for the same
-- reason as the other two: the refusal belongs one layer earlier than the policy.
revoke execute on function ez_finance.account_balances(uuid) from public, anon;

-- Re-asserted rather than assumed to have survived. A revoke from PUBLIC does not
-- touch a direct grant to authenticated, but this file exists because someone read a
-- grant and believed it covered the whole picture.
grant execute on function ez_finance.record_transfer(
  uuid, uuid, uuid, bigint, bigint, char, numeric, date, text
) to authenticated;

grant execute on function ez_finance.delete_transfer(uuid) to authenticated;
grant execute on function ez_finance.account_balances(uuid) to authenticated;

commit;
