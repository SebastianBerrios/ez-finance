// bootstrap.test.ts — unit tests for the authenticated-entry helper.
//
// Focus: the terminal DELETED state is read from PERSISTED state, never from
// "did this call erase the data". Deriving it from the sweep's return value
// makes the terminal notice unreachable the moment anything else finalizes the
// request first — a discarded Next.js prefetch render, or the scheduled batch
// worker, which is the dominant path. The account is then silently rebuilt.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockRpc, mockGetUser } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

import { bootstrapUserWorkspace } from "./bootstrap";

const WORKSPACE_ID = "ws-1";

const GRACE_PAYLOAD = {
  state: "GRACE_PERIOD",
  requested_at: "2026-06-25T10:00:00.000Z",
  ends_at: "2026-07-25T10:00:00.000Z",
};

function rpcResolves(overrides: Record<string, unknown> = {}) {
  const results: Record<string, unknown> = {
    deletion_state: { data: { state: "ACTIVE" }, error: null },
    process_deletion_if_due: { data: false, error: null },
    bootstrap: { data: WORKSPACE_ID, error: null },
    ...overrides,
  };
  mockRpc.mockImplementation(async (name: string) => results[name]);
}

function calledRpcs(): string[] {
  return mockRpc.mock.calls.map((call) => call[0] as string);
}

// Kept out of vi.restoreAllMocks(): that would also strip the implementation
// off the hoisted createServerClient mock and every later test would blow up.
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  rpcResolves();
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("bootstrapUserWorkspace", () => {
  it("returns the personal workspace id", async () => {
    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "READY") {
      expect(result.value.workspaceId).toBe(WORKSPACE_ID);
    } else {
      expect.unreachable("expected a READY entry");
    }
  });

  it("reads the lifecycle state before bootstrapping the workspace", async () => {
    await bootstrapUserWorkspace();

    expect(calledRpcs()).toEqual(["deletion_state", "bootstrap"]);
  });

  it("reports DELETED from persisted state even when THIS call erased nothing", async () => {
    // The regression. The batch worker (or a discarded prefetch render) already
    // finalized the request, so process_deletion_if_due() returns false for the
    // user forever. Deriving DELETED from that boolean re-provisions a fresh
    // empty account and the person is never told their data is gone.
    rpcResolves({
      deletion_state: {
        data: { state: "DELETED", finalized_at: "2026-07-25T10:00:00.000Z" },
        error: null,
      },
      process_deletion_if_due: { data: false, error: null },
    });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("DELETED");
    expect(calledRpcs()).not.toContain("bootstrap");
  });

  it("reports DELETED when the caller's own sweep is the one that erased it", async () => {
    // The grace window expired and nothing else got there first. Bootstrapping
    // here would recreate the profile and a fresh 'Personal' workspace in the
    // very request that destroyed them.
    rpcResolves({
      deletion_state: { data: GRACE_PAYLOAD, error: null },
      process_deletion_if_due: { data: true, error: null },
    });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("DELETED");
    expect(calledRpcs()).toEqual(["deletion_state", "process_deletion_if_due"]);
  });

  it("sweeps a pending window before bootstrapping", async () => {
    rpcResolves({ deletion_state: { data: GRACE_PAYLOAD, error: null } });

    await bootstrapUserWorkspace();

    expect(calledRpcs()).toEqual([
      "deletion_state",
      "process_deletion_if_due",
      "bootstrap",
    ]);
  });

  it("skips the sweep when nothing is pending", async () => {
    // ACTIVE means there is no request in the ledger at all, so the sweep can
    // only find nothing. Skipping it keeps the hot path at two round trips.
    await bootstrapUserWorkspace();

    expect(calledRpcs()).not.toContain("process_deletion_if_due");
  });

  it("treats a bootstrap refusal as the terminal state", async () => {
    // Backstop for the race the advisory lock serializes: the erasure committed
    // between the state read and the bootstrap. The database refuses to
    // re-provision, and that refusal must land on the notice, not on an error.
    rpcResolves({
      deletion_state: { data: { state: "ACTIVE" }, error: null },
      bootstrap: {
        data: null,
        error: { message: "account_deleted", code: "P0001" },
      },
    });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("DELETED");
  });

  it("still bootstraps when the lifecycle read fails transiently", async () => {
    // Not fatal: ez_finance.bootstrap() refuses on its own if the account was
    // erased, so the terminal state cannot be lost by a failed read here.
    rpcResolves({
      deletion_state: { data: null, error: { message: "boom" } },
    });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    expect(calledRpcs()).toContain("bootstrap");
  });

  it("logs a failing lifecycle read instead of swallowing it", async () => {
    rpcResolves({
      deletion_state: { data: null, error: { message: "boom" } },
    });

    await bootstrapUserWorkspace();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("deletion_state"),
      expect.objectContaining({ message: "boom" }),
    );
  });

  it("logs a failing sweep instead of swallowing it", async () => {
    // A permanently failing sweep means data is retained past the promised
    // date. Invisible failure is how that lasts for months.
    rpcResolves({
      deletion_state: { data: GRACE_PAYLOAD, error: null },
      process_deletion_if_due: { data: null, error: { message: "boom" } },
    });

    await bootstrapUserWorkspace();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("process_deletion_if_due"),
      expect.objectContaining({ message: "boom" }),
    );
  });

  it("does not call any RPC when there is no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("issues its RPCs on the client that validated the session", async () => {
    // getUser() can refresh the access token. Validating on one client and then
    // calling RPCs on a second one sends the stale token.
    const { createServerClient } =
      await import("@/shared/infrastructure/supabase/server");

    await bootstrapUserWorkspace();

    expect(createServerClient).toHaveBeenCalledTimes(1);
  });

  it("maps a bootstrap RPC failure to a domain error", async () => {
    rpcResolves({
      bootstrap: { data: null, error: { message: "jwt_expired" } },
    });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
  });
});
