// GET /api/cron/process-deletions — the scheduled caller for the account
// deletion pipeline.
//
// WHY THIS EXISTS: ez_finance.process_due_deletions() had no caller. Native
// Supabase scheduling needs pg_cron + pg_net and NEITHER is installed in
// mvp-lab, so a scheduled Edge Function is not available on this stack. The
// dominant path — request deletion, get signed out, never return — therefore
// never finalized: the data was retained forever while the UI promised a date.
// Vercel Cron drives this route instead; the schedule lives in vercel.json.
//
// WHY IT LOOPS: process_due_deletions() finalizes at most BATCH_LIMIT accounts
// per call, and its own default is 100. With a once-a-day schedule and users
// who by definition never come back to trigger their own sweep, any backlog
// above that grows monotonically and never drains. So the handler keeps asking
// for another batch until one finalizes nothing, or until the time budget runs
// out — whichever comes first.
//
// WHY IT GUARDS ITSELF: `api/` is excluded from the middleware matcher, and
// this endpoint erases accounts in bulk. The Vercel Cron convention is a
// CRON_SECRET bearer token, compared in constant time so the handler is not
// itself an oracle for the secret. An ordinary browser session cannot reach it:
// a session cookie is not an Authorization header. Every rejection is logged —
// a rotated, typo'd or Preview-only secret otherwise kills the whole retention
// pipeline in complete silence.
import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createServiceClient } from "@/shared/infrastructure/supabase/service-client";

// Never prerendered, never cached: it mutates.
export const dynamic = "force-dynamic";

// The drain loop needs room to run more than one batch. 60s is the Hobby-plan
// ceiling; the budget below stops well short of it so the last batch always
// finishes and gets logged instead of being cut off mid-erasure.
export const maxDuration = 60;

/**
 * Deliberately small. process_due_deletions() runs its whole loop inside ONE
 * transaction and re-raises infrastructure errors (statement timeout, admin
 * shutdown, serialization, deadlock) instead of swallowing them, so whatever a
 * call finalized before such an error ROLLS BACK. A large slice therefore turns
 * one slow night into permanent zero progress: the next run re-selects the same
 * oldest rows and dies the same way. Volume is the drain loop's job, not the
 * slice's.
 */
const BATCH_LIMIT = 100;

/** Leaves ~10s of the maxDuration for the batch already in flight. */
const TIME_BUDGET_MS = 50_000;

interface BatchCounts {
  readonly finalized: number;
  readonly skipped: number;
  readonly contended: number;
}

/**
 * Read the jsonb payload of ez_finance.process_due_deletions().
 *
 * Returns null on anything unexpected. A renamed key must NOT read as zero:
 * "nothing was due" is the one answer this job can never be allowed to fake.
 */
function readCounts(payload: unknown): BatchCounts | null {
  if (payload === null || typeof payload !== "object") return null;

  const { finalized, skipped, contended } = payload as Record<string, unknown>;

  if (
    typeof finalized !== "number" ||
    typeof skipped !== "number" ||
    typeof contended !== "number"
  ) {
    return null;
  }

  return { finalized, skipped, contended };
}

/**
 * Constant-time string comparison.
 *
 * timingSafeEqual() throws on length mismatch and would leak the secret's
 * length, so both sides are hashed to a fixed 32 bytes first. The digests are
 * only ever compared, never logged or returned.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env["CRON_SECRET"];

  if (!secret) {
    // Fail closed. An unset secret must never degrade into "no auth required"
    // on a mass-erasure endpoint. The response says nothing about why.
    console.error(
      "[cron/process-deletions] unauthorized: CRON_SECRET is not configured — refusing to run",
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const presented = request.headers.get("authorization") ?? "";

  if (!secretsMatch(presented, `Bearer ${secret}`)) {
    console.error(
      "[cron/process-deletions] unauthorized: the presented bearer token does not match CRON_SECRET",
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let finalized = 0;
  let runs = 0;
  let drained = false;

  // Counts from the batch that STOPPED the drain, not sums. Every pass
  // re-selects the same stuck rows, so a cumulative total would report
  // "contended 4" for ONE stuck user drained over four passes — inflating the
  // single number an operator uses to decide whether something is wedged.
  let skipped = 0;
  let contended = 0;

  try {
    const supabase = createServiceClient();

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data, error } = await supabase.rpc("process_due_deletions", {
        p_limit: BATCH_LIMIT,
      });

      if (error) {
        console.error(
          "[cron/process-deletions] process_due_deletions failed:",
          error,
        );
        return NextResponse.json({ error: "failed" }, { status: 500 });
      }

      const counts = readCounts(data);

      if (counts === null) {
        console.error(
          "[cron/process-deletions] unreadable process_due_deletions payload:",
          data,
        );
        return NextResponse.json({ error: "failed" }, { status: 500 });
      }

      runs += 1;
      finalized += counts.finalized;
      skipped = counts.skipped;
      contended = counts.contended;

      // Only a batch that erased NOTHING ends the drain.
      //
      // A poison row must not end it: the SQL loop isolates each finalization
      // in its own subtransaction, so the rest of that batch still committed
      // and the next pass still erases healthy rows. Breaking out on skipped
      // capped the entire pipeline at one batch per run because of one bad row.
      if (counts.finalized === 0) {
        // Skipped and contended rows are pending work, not finished work, so
        // "drained" is only honest when the last batch found neither.
        drained = counts.skipped === 0 && counts.contended === 0;
        break;
      }
    }
  } catch (e) {
    console.error("[cron/process-deletions] unexpected failure:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  const summary =
    `[cron/process-deletions] finalized ${finalized} over ${runs} batch(es); ` +
    `last batch skipped ${skipped}, contended ${contended}` +
    (drained ? "" : " — WORK REMAINS");

  if (skipped > 0) {
    // The failure mode that matters. HTTP 200 with "finalized 0" is exactly
    // what a completely broken pipeline used to look like, on a promise to
    // erase this data within 30 days.
    console.error(summary);
    return NextResponse.json(
      { finalized, skipped, contended, runs, drained },
      { status: 500 },
    );
  }

  if (contended > 0) {
    // Usually transient — a returning user's own sweep holds their advisory
    // lock. But a user contended on EVERY run is never finalized, and at 200
    // with an info-level log nothing would ever surface that.
    console.error(summary);
    return NextResponse.json({ finalized, skipped, contended, runs, drained });
  }

  // The only audit trail this job has.
  console.log(summary);

  return NextResponse.json({ finalized, skipped, contended, runs, drained });
}
