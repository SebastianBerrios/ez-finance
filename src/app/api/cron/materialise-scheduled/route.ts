// GET /api/cron/materialise-scheduled — the daily driver for scheduled transactions.
//
// WHY A VERCEL CRON AND NOT pg_cron: neither pg_cron nor pg_net is installed in
// mvp-lab, so a scheduled Edge Function is not available on this stack. The same
// reasoning, and the same shape, as /api/cron/process-deletions.
//
// WHY THERE IS NO DRAIN LOOP HERE, unlike the deletion worker. That one finalises at
// most BATCH_LIMIT accounts per CALL, so a backlog needs several calls. This one is
// bounded differently: materialise_due_transactions() walks every missed occurrence for
// every schedule it takes in ONE call, and the limit is a number of SCHEDULES, not of
// rows. A workspace with more than 500 active schedules is not a real scenario today,
// and pretending to handle it with a loop would be untested code guarding an
// imaginary case. If it ever becomes real, the log below is what will say so.
import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createServiceClient } from "@/shared/infrastructure/supabase/service-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Schedules examined per run, not rows written. */
const SCHEDULE_LIMIT = 500;

interface Counts {
  readonly created: number;
  readonly schedules: number;
}

/**
 * Read the jsonb payload.
 *
 * Returns null on anything unexpected. A renamed key must NOT read as zero: "nothing
 * was due" is an answer this job should never be able to fake, because a silently
 * broken scheduler looks exactly like a month where nothing was scheduled.
 */
function readCounts(payload: unknown): Counts | null {
  if (payload === null || typeof payload !== "object") return null;

  const { created, schedules } = payload as Record<string, unknown>;

  if (typeof created !== "number" || typeof schedules !== "number") return null;

  return { created, schedules };
}

/**
 * Constant-time comparison. timingSafeEqual throws on length mismatch and would leak
 * the secret's length, so both sides are hashed to a fixed 32 bytes first.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env["CRON_SECRET"];

  if (!secret) {
    // Fail closed. An unset secret must never degrade into "no auth required" on an
    // endpoint that writes money.
    console.error(
      "[cron/materialise-scheduled] unauthorized: CRON_SECRET is not configured — refusing to run",
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const presented = request.headers.get("authorization") ?? "";

  if (!secretsMatch(presented, `Bearer ${secret}`)) {
    console.error(
      "[cron/materialise-scheduled] unauthorized: the presented bearer token does not match CRON_SECRET",
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase.rpc("materialise_due_transactions", {
      p_limit: SCHEDULE_LIMIT,
    });

    if (error) {
      console.error("[cron/materialise-scheduled] rpc failed:", error);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }

    const counts = readCounts(data);

    if (counts === null) {
      console.error("[cron/materialise-scheduled] unreadable payload:", data);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }

    // The only audit trail this job has. `schedules` hitting the limit is the signal
    // that the no-loop decision above needs revisiting.
    const summary =
      `[cron/materialise-scheduled] created ${counts.created} transaction(s) ` +
      `from ${counts.schedules} schedule(s)` +
      (counts.schedules >= SCHEDULE_LIMIT
        ? " — LIMIT REACHED, work may remain"
        : "");

    if (counts.schedules >= SCHEDULE_LIMIT) {
      console.error(summary);
    } else {
      console.log(summary);
    }

    return NextResponse.json(counts);
  } catch (e) {
    console.error("[cron/materialise-scheduled] unexpected failure:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
