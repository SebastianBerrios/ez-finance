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
// WHY IT GUARDS ITSELF: `api/` is excluded from the middleware matcher, and
// this endpoint erases up to 1000 accounts per call. The Vercel Cron convention
// is a CRON_SECRET bearer token, compared in constant time so the handler is
// not itself an oracle for the secret. An ordinary browser session cannot reach
// it: a session cookie is not an Authorization header.
import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createServiceClient } from "@/shared/infrastructure/supabase/service-client";

// Never prerendered, never cached: it mutates.
export const dynamic = "force-dynamic";

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
      "[cron/process-deletions] CRON_SECRET is not configured — refusing to run",
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const presented = request.headers.get("authorization") ?? "";

  if (!secretsMatch(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("process_due_deletions");

    if (error) {
      console.error(
        "[cron/process-deletions] process_due_deletions failed:",
        error,
      );
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }

    const finalized = typeof data === "number" ? data : 0;

    // The only audit trail this job has.
    console.log(
      `[cron/process-deletions] finalized ${finalized} account deletion(s)`,
    );

    return NextResponse.json({ finalized });
  } catch (e) {
    console.error("[cron/process-deletions] unexpected failure:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
