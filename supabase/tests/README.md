# Database behaviour tests

Applying a migration only proves the SQL parses: PL/pgSQL function bodies are
not executed at `CREATE` time, so a logic error inside a `SECURITY DEFINER`
function survives `supabase db reset` unnoticed. These scripts exercise the
functions the way the app does — impersonating `authenticated`, `anon` and
`service_role` with JWT claims — and fail loudly on the first broken
expectation.

## Running them

The scripts assume a freshly reset local stack (they insert their own fixtures
into `auth.users` and do not clean up):

```bash
pnpm exec supabase db reset
docker cp supabase/tests/account_deletion.sql supabase_db_ez-finance:/tmp/t.sql
MSYS_NO_PATHCONV=1 docker exec supabase_db_ez-finance psql -U postgres -d postgres -f /tmp/t.sql
```

A successful run ends with `ALL CHECKS PASSED`; any failure aborts with
`ERROR: FAIL: <expectation>`. `MSYS_NO_PATHCONV=1` matters on Git Bash for
Windows only — without it `/tmp/t.sql` is rewritten into a Windows path.

Re-running WITHOUT a reset fails on `duplicate key value violates unique
constraint "users_pkey"`: the fixtures are fixed UUIDs. Reset first.

## account_deletion.sql

Covers the whole account-deletion feature, across five migrations:

**`20260725120000` — the lifecycle.**
The ACTIVE → GRACE_PERIOD → finalized path and the conflicts that guard it
(double request, cancel with nothing pending, cancel after the window closed);
the scope of the erasure — profile and sole-member personal workspaces are
removed, shared workspaces keep a tombstoned membership carrying the name
snapshot, the peer member is untouched, and **the `auth.users` row is never
deleted** (it is shared with the other apps in `mvp-lab`); idempotency of the
due-request sweep; and that anonymous callers are rejected while
`authenticated` can neither read the private ledger nor call
`finalize_deletion` directly.

**`20260725130000` — least privilege.**
`anon` has no EXECUTE on any deletion RPC, and `authenticated` keeps its own.
Both the PUBLIC and the `anon` grant have to be revoked: Postgres grants
EXECUTE to PUBLIC on every new function, and the schema's DEFAULT PRIVILEGES
keep handing routines to `anon`.

**`20260725152455` + `20260725164259` — the out-of-band batch worker.**
`process_due_deletions()` finalizes accounts it holds no session for, skips
not-yet-due and cancelled requests, and never touches `auth.users`. Since
`20260725164259` it also: refuses any JWT role other than `service_role` **in
the function body**, not only at the grant (one re-run of the fleet onboarding
`grant all on routines` would otherwise expose a mass-erasure endpoint to the
public anon key); bounds the batch by `p_limit`, treating `p_limit <= 0` as
"unspecified" rather than zero; and survives a poison row — a finalization that
always fails is warned about and skipped instead of aborting the transaction,
which used to freeze the pipeline permanently because the failing row sorts
first on every run.

**`20260725152507` — no orphaned workspaces.**
A tombstone (`user_id IS NULL`) is not a member, so a personal workspace
holding only tombstoned peers is removed; and a shared workspace whose last
live member just left is erased rather than left unreachable forever.

**`20260725164257` — the terminal state.**
`deletion_state()` reports `DELETED` from an unacknowledged finalized request,
so the notice is reached no matter WHO finalized it — the section drives this
through a user the batch worker erased, whose own
`process_deletion_if_due()` therefore returns false. `bootstrap()` refuses to
re-provision while that row is unacknowledged, `acknowledge_deletion()` clears
it, and only then does `bootstrap()` work again. `acknowledge_deletion()` is
`authenticated`-only.

## Gotchas worth remembering

- `x BETWEEN a AND b` expands into two comparisons, so a VOLATILE function used
  as `x` is called **twice**. Capture the call into a variable before asserting.
- `raise exception 'FAIL: ...'` defaults to SQLSTATE `P0001`, the same code the
  RPCs use for their domain errors. A `when sqlstate 'P0001'` handler will
  therefore swallow the test's own failure — always re-check `sqlerrm` inside
  the handler, as every block here does.
- The in-body guard of `process_due_deletions()` is tested as `postgres` with
  forged `request.jwt.claims`, precisely so the grant is NOT what refuses the
  call. Testing it as the `anon` role would only prove the grant works.

## What these scripts do NOT cover

The application seam. `tests/e2e/account-lifecycle.spec.ts` drives the same
functions through the real UI — including the terminal path, by backdating
`ends_at` and running the batch worker against this same container.
