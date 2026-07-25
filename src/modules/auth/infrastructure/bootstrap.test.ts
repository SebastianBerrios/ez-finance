// bootstrap.test.ts — unit tests for the authenticated-entry helper.
// Focus: the due-deletion sweep runs BEFORE the workspace bootstrap. Getting
// that order wrong would let bootstrap() recreate a profile that the deletion
// then erases, leaving the user with no profile at all.
import { describe, expect, it, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  rpcResolves();
});

describe("bootstrapUserWorkspace", () => {
  it("returns the personal workspace id", async () => {
    const result = await bootstrapUserWorkspace();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.workspaceId).toBe(WORKSPACE_ID);
  });

  it("sweeps a due deletion before bootstrapping the workspace", async () => {
    await bootstrapUserWorkspace();

    expect(mockRpc.mock.calls.map((call) => call[0])).toEqual([
      "process_deletion_if_due",
      "bootstrap",
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
