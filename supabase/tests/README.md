# Database behaviour tests

Applying a migration only proves the SQL parses: PL/pgSQL function bodies are
not executed at `CREATE` time, so a logic error inside a `SECURITY DEFINER`
function survives `supabase db reset` unnoticed. These scripts exercise the
functions the way the app does — impersonating `authenticated` with JWT
claims — and fail loudly on the first broken expectation.

## Running them

The scripts assume a freshly reset local stack (they insert their own fixtures
into `auth.users` and do not clean up):

```bash
pnpm exec supabase db reset
docker cp supabase/tests/account_deletion.sql supabase_db_ez-finance:/tmp/t.sql
docker exec supabase_db_ez-finance psql -U postgres -d postgres -f /tmp/t.sql
```

A successful run ends with `ALL CHECKS PASSED`; any failure aborts with
`ERROR: FAIL: <expectation>`.

## account_deletion.sql

Covers `20260725120000_ez_finance_account_deletion.sql`:

- the ACTIVE → GRACE_PERIOD → finalized lifecycle, and the conflicts that
  guard it (double request, cancel with nothing pending, cancel after the
  window closed);
- the scope of the erasure — profile and sole-member personal workspaces are
  removed, shared workspaces survive with a tombstoned membership carrying the
  name snapshot, the peer member is untouched, and **the `auth.users` row is
  never deleted** (it is shared with the other apps in `mvp-lab`);
- idempotency of the due-request sweep;
- that anonymous callers are rejected, and that `authenticated` can neither
  read the private deletion ledger nor call `finalize_deletion` directly.

Gotcha worth remembering: `x BETWEEN a AND b` expands into two comparisons, so
a VOLATILE function used as `x` is called **twice**. Capture the call into a
variable before asserting on it.
