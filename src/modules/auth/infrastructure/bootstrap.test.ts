// bootstrap.test.ts — unit tests for the authenticated-entry helper.
// Focus: the due-deletion sweep runs BEFORE the workspace bootstrap, and a
// sweep that actually erased the account STOPS the entry instead of quietly
// rebuilding it. Getting either wrong hands the user a working empty account
// and makes the terminal DELETED state unreachable.
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

function rpcResolves(overrides: Record<string, unknown> = {}) {
  const results: Record<string, unknown> = {
    process_deletion_if_due: { data: false, error: null },
    bootstrap: { data: WORKSPACE_ID, error: null },
    ...overrides,
  };
  mockRpc.mockImplementation(async (name: string) => results[name]);
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

  it("sweeps a due deletion before bootstrapping the workspace", async () => {
    await bootstrapUserWorkspace();

    expect(mockRpc.mock.calls.map((call) => call[0])).toEqual([
      "process_deletion_if_due",
      "bootstrap",
    ]);
  });

  it("reports DELETED and does NOT bootstrap when the sweep erased the account", async () => {
    // Bootstrapping here would recreate the profile and a fresh 'Personal'
    // workspace in the very request that destroyed them.
    rpcResolves({ process_deletion_if_due: { data: true, error: null } });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("DELETED");
    expect(mockRpc.mock.calls.map((call) => call[0])).toEqual([
      "process_deletion_if_due",
    ]);
  });

  it("still bootstraps when the deletion sweep fails transiently", async () => {
    // A failed sweep must not lock the user out: the request stays pending and
    // the next authenticated entry retries it.
    rpcResolves({
      process_deletion_if_due: { data: null, error: { message: "boom" } },
    });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    expect(mockRpc.mock.calls.map((call) => call[0])).toContain("bootstrap");
  });

  it("logs a failing sweep instead of swallowing it", async () => {
    // A permanently failing sweep means data is retained past the promised
    // date. Invisible failure is how that lasts for months.
    rpcResolves({
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

  it("maps a bootstrap RPC failure to a domain error", async () => {
    rpcResolves({
      bootstrap: { data: null, error: { message: "jwt_expired" } },
    });

    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
  });
});
