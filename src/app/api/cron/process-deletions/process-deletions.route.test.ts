// process-deletions.route.test.ts — the scheduled caller for the account
// deletion pipeline.
//
// ez_finance.process_due_deletions() is a mass-erasure endpoint. This handler
// is the only thing in the system that calls it, it holds the service-role key,
// and `api/` is excluded from the middleware matcher — so it guards itself or
// it is not guarded at all. The auth branch is the contract.
//
// The other half of the contract is OBSERVABILITY. This job runs unattended,
// once a day, against a 30-day retention promise. "Nothing was due" and "every
// finalization threw" must never look the same from the outside.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockRpc, mockCreateServiceClient } = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    mockRpc: rpc,
    mockCreateServiceClient: vi.fn(() => ({ rpc })),
  };
});

vi.mock("@/shared/infrastructure/supabase/service-client", () => ({
  createServiceClient: mockCreateServiceClient,
}));

import { GET, maxDuration } from "./route";

const SECRET = "s3cr3t-cron-token";
const URL_UNDER_TEST = "http://localhost:3000/api/cron/process-deletions";

function request(authorization?: string) {
  return new Request(
    URL_UNDER_TEST,
    authorization === undefined ? undefined : { headers: { authorization } },
  );
}

/** A jsonb payload shaped like ez_finance.process_due_deletions() returns. */
function batch(finalized: number, skipped = 0, contended = 0) {
  return { data: { finalized, skipped, contended }, error: null };
}

/** Queue one reply per call, repeating the last one forever. */
function batches(...replies: ReturnType<typeof batch>[]) {
  let index = 0;
  mockRpc.mockImplementation(async () => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return reply;
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  batches(batch(3), batch(0));
});

afterEach(() => {
  vi.unstubAllEnvs();
  consoleError.mockRestore();
  consoleLog.mockRestore();
});

describe("GET /api/cron/process-deletions", () => {
  it("finalizes the due batch and reports both counts", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ finalized: 3, skipped: 0 });
  });

  it("asks for an explicit batch size instead of inheriting the database default", async () => {
    await GET(request(`Bearer ${SECRET}`));

    const [, args] = mockRpc.mock.calls[0] as [string, { p_limit?: number }];
    expect(args?.p_limit).toBeGreaterThan(0);
  });

  it("keeps the slice small so one timeout cannot discard a huge batch", async () => {
    // process_due_deletions() runs its whole loop in ONE transaction and now
    // re-raises statement timeouts instead of swallowing them, so everything
    // finalized in that call rolls back. A 1000-row slice turns a slow night
    // into permanent zero progress; the drain loop is what handles volume.
    await GET(request(`Bearer ${SECRET}`));

    const [, args] = mockRpc.mock.calls[0] as [string, { p_limit?: number }];
    expect(args?.p_limit).toBeLessThanOrEqual(200);
  });

  it("keeps running batches until one finalizes nothing", async () => {
    batches(batch(1000), batch(1000), batch(7), batch(0));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(await response.json()).toMatchObject({ finalized: 2007 });
    expect(mockRpc).toHaveBeenCalledTimes(4);
  });

  it("declares a maxDuration so the drain loop is not cut off mid-batch", () => {
    expect(typeof maxDuration).toBe("number");
    expect(maxDuration).toBeGreaterThan(0);
  });

  it("logs how many accounts it erased AND how many it could not", async () => {
    // A silent mass-erasure job is one nobody can audit.
    await GET(request(`Bearer ${SECRET}`));

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("finalized 3"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("skipped 0"),
    );
  });

  it("answers non-200 and logs at error level when the batch skipped rows", async () => {
    // This is THE failure mode that matters: HTTP 200 + "finalized 0" is what a
    // completely broken pipeline used to look like.
    batches(batch(0, 4));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ finalized: 0, skipped: 4 });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("skipped 4"),
    );
  });

  it("does NOT report the queue drained when every candidate was contended", async () => {
    // {finalized: 0, skipped: 0, contended: N} means somebody else holds those
    // users' advisory locks — the work is pending, not done. Reporting
    // "drained" here is the same silent-success bug one level up from the SQL.
    batches(batch(0, 0, 5));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(await response.json()).toMatchObject({
      drained: false,
      contended: 5,
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("contended 5"),
    );
  });

  it("keeps draining past a poison row instead of throttling to one batch", async () => {
    // A skipped row is isolated in its own subtransaction, so the REST of that
    // batch still committed and the next pass still erases healthy rows.
    // Breaking out capped the whole pipeline at one batch per run because of
    // one bad row.
    batches(batch(10, 1), batch(7, 1), batch(0, 1));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(await response.json()).toMatchObject({ finalized: 17 });
  });

  it("reports the stuck counts of the final batch, not the sum over retries", async () => {
    // The same poison row is re-selected by every batch. Summing would report
    // "skipped 3" for ONE stuck user drained over three passes.
    batches(batch(10, 1), batch(5, 1), batch(0, 1));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(await response.json()).toMatchObject({ finalized: 15, skipped: 1 });
  });

  it("stops looping once a batch finalizes nothing", async () => {
    batches(batch(0, 4));

    await GET(request(`Bearer ${SECRET}`));

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it("logs every rejection", async () => {
    // A rotated, typo'd or Preview-only CRON_SECRET kills the whole retention
    // pipeline. Without a log line there is nothing to notice.
    await GET(request("Bearer not-the-secret"));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("unauthorized"),
    );
  });

  it("rejects a wrong bearer token", async () => {
    const response = await GET(request("Bearer not-the-secret"));

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a token that is a prefix of the real one", async () => {
    const response = await GET(request(`Bearer ${SECRET.slice(0, 5)}`));

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a raw token without the Bearer scheme", async () => {
    const response = await GET(request(SECRET));

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses to run when CRON_SECRET is not configured", async () => {
    // Fail closed: an unset secret must not turn into "no auth required".
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request("Bearer "));

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("returns a non-200 and logs when the RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).not.toBe(200);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("process_due_deletions"),
      expect.objectContaining({ message: "boom" }),
    );
  });

  it("returns a non-200 and logs when the client itself blows up", async () => {
    mockCreateServiceClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).not.toBe(200);
    expect(console.error).toHaveBeenCalled();
  });

  it("treats an unreadable payload as a failed run rather than an idle one", async () => {
    // A renamed jsonb key must not read as "nothing was due".
    mockRpc.mockResolvedValue({ data: 3, error: null });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).not.toBe(200);
    expect(console.error).toHaveBeenCalled();
  });

  it("never echoes the secret in a response", async () => {
    const response = await GET(request("Bearer wrong"));
    const body = await response.text();

    expect(body).not.toContain(SECRET);
  });
});
