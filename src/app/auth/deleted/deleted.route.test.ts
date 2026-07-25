// deleted.route.test.ts — the terminal exit after an account erasure.
//
// This is an UNAUTHENTICATED-reachable GET that signs the caller out and then
// tells them "we deleted your data". Anyone can trigger it: a typed URL, a
// shared link, an <img src>, a crawler, or the browser Back button after the
// real flow. So the contract is: verify the CURRENT session actually has a
// finalized, unacknowledged deletion BEFORE doing anything destructive.
//
// Only the Supabase client is mocked: the real adapters and the real logout use
// case run, so the sign-out scope is part of what these tests pin.
import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetUser, mockSignOut, mockRpc } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
    rpc: mockRpc,
  }),
}));

import { GET } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const URL_UNDER_TEST = "http://localhost:3000/auth/deleted";

const DELETED_PAYLOAD = {
  state: "DELETED",
  finalized_at: "2026-07-25T10:00:00.000Z",
};

function rpcResolves(overrides: Record<string, unknown> = {}) {
  const results: Record<string, unknown> = {
    deletion_state: { data: DELETED_PAYLOAD, error: null },
    acknowledge_deletion: { data: null, error: null },
    ...overrides,
  };
  mockRpc.mockImplementation(async (name: string) => results[name]);
}

function request() {
  return new NextRequest(URL_UNDER_TEST);
}

function calledRpcs(): string[] {
  return mockRpc.mock.calls.map((call) => call[0] as string);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mockSignOut.mockResolvedValue({ error: null });
  rpcResolves();
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("GET /auth/deleted", () => {
  it("signs out and announces the erasure when the session really is deleted", async () => {
    const response = await GET(request());

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?deletion=completed",
    );
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("acknowledges the erasure BEFORE closing the session", async () => {
    // acknowledge_deletion() derives the user from auth.uid(), so it cannot run
    // after the sign-out. Without it the account stays terminal forever and the
    // person can never start over.
    await GET(request());

    expect(calledRpcs()).toEqual(["deletion_state", "acknowledge_deletion"]);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("signs out of THIS browser only", async () => {
    // mvp-lab shares auth.users with the rest of the fleet: the ez finance data
    // is gone, the identity still belongs to the other apps.
    await GET(request());

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not touch a live session that has no finalized deletion", async () => {
    // The drive-by case: a typed URL, a shared link, an <img src>, a crawler,
    // or the Back button. Signing this person out and telling them their data
    // was erased is a lie with a side effect.
    rpcResolves({ deletion_state: { data: { state: "ACTIVE" }, error: null } });

    const response = await GET(request());

    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(calledRpcs()).not.toContain("acknowledge_deletion");
  });

  it("does not announce an erasure to someone merely inside the grace window", async () => {
    rpcResolves({
      deletion_state: {
        data: {
          state: "GRACE_PERIOD",
          requested_at: "2026-07-01T10:00:00.000Z",
          ends_at: "2026-07-31T10:00:00.000Z",
        },
        error: null,
      },
    });

    const response = await GET(request());

    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("sends an anonymous caller to login with no message and no sign-out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request());

    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails closed and logs when the lifecycle read fails", async () => {
    rpcResolves({
      deletion_state: { data: null, error: { message: "boom" } },
    });

    const response = await GET(request());

    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("still closes the session when the acknowledgement fails, and logs it", async () => {
    // The data IS erased either way. A session that outlives the erasure walks
    // straight back into a freshly bootstrapped empty account.
    rpcResolves({
      acknowledge_deletion: { data: null, error: { message: "boom" } },
    });

    const response = await GET(request());

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?deletion=completed",
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("logs a failed sign-out instead of swallowing it", async () => {
    mockSignOut.mockResolvedValue({ error: { message: "boom" } });

    await GET(request());

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("sign-out"),
      expect.anything(),
    );
  });
});
