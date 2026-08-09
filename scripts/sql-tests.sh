#!/usr/bin/env bash
#
# Run every behavioural database suite in supabase/tests against the LOCAL stack.
#
# WHY THIS IS A SCRIPT. Applying a migration only proves the SQL parses: PL/pgSQL
# bodies are not executed at CREATE time, so a logic error inside a SECURITY DEFINER
# function survives `db reset` unnoticed. These suites are the only thing that catches
# that — and until this script existed they were run by hand, which is why one of them
# (account_deletion.sql §19) had been failing on main for ten days while correctly
# reporting a real production bug nobody had asked it about.
#
# Three details that cost real time to rediscover, now encoded rather than remembered:
#
#   1. THE SUITE LIST IS A GLOB, never a hardcoded array. A suite someone adds and
#      forgets to register is a suite that never runs, which is the exact failure this
#      script exists to prevent.
#
#   2. `supabase db reset` RESTARTS THE CONTAINERS, which wipes /tmp. The file has to
#      be copied in AFTER the reset, not before — copy first and psql reads nothing,
#      or worse, the previous suite's file.
#
#   3. deletion_deadlock.sql must be invoked over TCP. `postgres` is not a superuser
#      on Supabase and dblink refuses a connection that did not present a password;
#      127.0.0.1 and the unix socket are `trust` in the local pg_hba, so only the
#      container's own address falls under the scram rule. Invoked over the socket it
#      fails with a message that reads like a code bug and is not one.
#
#      `hostname -i` can return SEVERAL addresses (IPv4 and IPv6), and it does on the
#      GitHub runner even though it returns one locally — which passed here and failed
#      there, feeding psql two hosts in a single -h. Only the first is used.
#
# Each suite gets a fresh database because they insert their own fixtures into
# auth.users and deliberately do not clean up (see supabase/tests/README.md).
#
# Usage:  ./scripts/sql-tests.sh [suite-name ...]
#         With no arguments, runs all of them.
set -euo pipefail

CONTAINER="supabase_db_ez-finance"
# Harmless on Linux (the variable is simply unused); required under Git Bash on
# Windows, where /tmp/t.sql would otherwise be rewritten to a Windows path.
export MSYS_NO_PATHCONV=1

if [ "$#" -gt 0 ]; then
  suites=()
  for name in "$@"; do
    suites+=("supabase/tests/${name}.sql")
  done
else
  suites=(supabase/tests/*.sql)
fi

failed=()
total_checks=0

for file in "${suites[@]}"; do
  name="$(basename "$file" .sql)"

  # Reset FIRST, copy second. See note 2 above.
  pnpm exec supabase db reset >/dev/null 2>&1
  docker cp "$file" "$CONTAINER:/tmp/t.sql" >/dev/null

  if [ "$name" = "deletion_deadlock" ]; then
    # See note 3: dblink needs a real password, so the connection must be TCP, and
    # only the FIRST address of `hostname -i` is usable.
    output="$(docker exec -e PGPASSWORD=postgres "$CONTAINER" \
      sh -c 'psql -h "$(hostname -i | cut -d" " -f1)" -U postgres -d postgres -f /tmp/t.sql' 2>&1 || true)"
  else
    output="$(docker exec "$CONTAINER" \
      psql -U postgres -d postgres -f /tmp/t.sql 2>&1 || true)"
  fi

  checks="$(grep -c 'PASS:' <<<"$output" || true)"

  # ALL CHECKS PASSED is printed by the last statement of every suite. Its ABSENCE is
  # the failure signal — a suite that died halfway prints passes and then stops, so
  # counting passes is not enough to call it green.
  if grep -q 'ALL CHECKS PASSED' <<<"$output"; then
    printf 'ok    %-24s %s checks\n' "$name" "$checks"
    total_checks=$((total_checks + checks))
  else
    printf 'FAIL  %-24s\n' "$name"
    # The matching lines first: a suite that failed an EXPECTATION says so in one line,
    # and that line is the whole answer.
    grep -E 'FAIL|ERROR' <<<"$output" | head -5 || true
    # Then the tail, UNCONDITIONALLY. The first version printed only the grep matches,
    # and the first real CI failure produced none of them — a suite that cannot connect
    # at all says nothing this pattern matches, so the run reported "FAIL" and no
    # reason, which is the one thing a test runner must never do.
    echo "      --- last lines of output ---"
    tail -15 <<<"$output" | sed 's/^/      /'
    failed+=("$name")
  fi
done

echo
if [ "${#failed[@]}" -gt 0 ]; then
  echo "${#failed[@]} suite(s) failed: ${failed[*]}"
  exit 1
fi

echo "all suites passed — ${total_checks} checks across ${#suites[@]} suites"
