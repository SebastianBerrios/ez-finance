// process-deletions.route.test.ts — the scheduled caller for the account
// deletion pipeline.
//
// ez_finance.process_due_deletions() is a mass-erasure endpoint. This handler
// is the only thing in the system that calls it, it holds the service-role key,
// and `api/` is excluded from the middleware matcher — so it guards itself or
// it is not guarded at all. The auth branch is the contract.
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

import { GET } from "./route";

const SECRET = "s3cr3t-cron-token";
const URL_UNDER_TEST = "http://localhost:3000/api/cron/process-deletions";

function request(authorization?: string) {
  return new Request(
    URL_UNDER_TEST,
    authorization === undefined
      ? undefined
      : { headers: { authorization } },
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  mockRpc.mockResolvedValue({ data: 3, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  consoleError.mockRestore();
  consoleLog.mockRestore();
});

describe("GET /api/cron/process-deletions", () => {
  it("finalizes the due batch and returns the count", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ finalized: 3 });
    expect(mockRpc).toHaveBeenCalledWith("process_due_deletions");
  });

  it("logs how many accounts it erased", async () => {
    // A silent mass-erasure job is one nobody can audit.
    await GET(request(`Bearer ${SECRET}`));

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("3"));
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
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

  it("never echoes the secret in a response", async () => {
    const response = await GET(request("Bearer wrong"));
    const body = await response.text();

    expect(body).not.toContain(SECRET);
  });
});
