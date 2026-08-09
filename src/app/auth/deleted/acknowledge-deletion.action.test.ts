// acknowledge-deletion.action.test.ts — the terminal exit after an erasure.
//
// This action consumes a ONE-SHOT fact ("this person has been told their data
// is gone") and closes the session. The order is the whole contract:
//
//   * acknowledge FIRST and the sign-out fails -> the session survives, the
//     middleware bounces the still-authenticated user off /login back to /app,
//     deletion_state() now reports ACTIVE (just acknowledged), bootstrap() no
//     longer refuses, and the user is handed a fresh empty account. Permanently,
//     because the one-shot acknowledgement is spent.
//   * sign out FIRST and the acknowledgement fails -> the state stays terminal,
//     the notice is shown again on the next entry, and nothing is lost.
//
// It is also why this is an ACTION and not the GET route handler it replaced: a
// cross-site <img src="/auth/deleted"> used to fire both side effects on a
// DELETED user without ever showing them the notice.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetUser, mockGetSession, mockSignOut, mockRpc, mockBearerRpc } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockGetSession: vi.fn(),
    mockSignOut: vi.fn(),
    mockRpc: vi.fn(),
    mockBearerRpc: vi.fn(),
  }));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
      signOut: mockSignOut,
    },
    rpc: mockRpc,
  }),
}));

vi.mock("@/shared/infrastructure/supabase/bearer-client", () => ({
  createBearerClient: vi.fn(() => ({ rpc: mockBearerRpc })),
}));

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import { acknowledgeDeletionAction } from "./acknowledge-deletion.action";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCESS_TOKEN = "header.payload.signature";

const DELETED_PAYLOAD = {
  state: "DELETED",
  finalized_at: "2026-07-25T10:00:00.000Z",
};

/** Every side effect, in the order it actually happened. */
const trace: string[] = [];

let consoleError: ReturnType<typeof vi.spyOn>;

function stateResolves(payload: unknown, error: unknown = null) {
  mockRpc.mockImplementation(async (name: string) => {
    trace.push(`rpc:${name}`);
    if (name === "deletion_state") return { data: payload, error };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  trace.length = 0;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: ACCESS_TOKEN } },
    error: null,
  });
  mockSignOut.mockImplementation(async () => {
    trace.push("signOut");
    return { error: null };
  });
  mockBearerRpc.mockImplementation(async (name: string) => {
    trace.push(`bearer:${name}`);
    return { data: null, error: null };
  });
  stateResolves(DELETED_PAYLOAD);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("acknowledgeDeletionAction", () => {
  it("closes the session BEFORE acknowledging, then announces the erasure", async () => {
    await expect(acknowledgeDeletionAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(trace).toEqual([
      "rpc:deletion_state",
      "signOut",
      "bearer:acknowledge_deletion",
    ]);
    expect(mockRedirect).toHaveBeenCalledWith("/login?deletion=completed");
  });

  it("signs out of THIS browser only", async () => {
    // mvp-lab shares auth.users with the rest of the fleet: the ez finance data
    // is gone, the identity still belongs to the other apps.
    await expect(acknowledgeDeletionAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does NOT acknowledge when the sign-out failed", async () => {
    // Spending the one-shot acknowledgement on a session that survived is how
    // an erased user silently gets a fresh empty account.
    mockSignOut.mockResolvedValue({ error: { message: "boom" } });

    const state = await acknowledgeDeletionAction();

    expect(mockBearerRpc).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(state.error).toBeTruthy();
    expect(console.error).toHaveBeenCalled();
  });

  it("leaks no provider detail when the sign-out fails", async () => {
    mockSignOut.mockResolvedValue({
      error: { message: "PGRST301 upstream exploded", code: "PGRST301" },
    });

    const state = await acknowledgeDeletionAction();

    expect(state.error).not.toContain("PGRST301");
  });

  it("still announces the erasure when only the acknowledgement failed", async () => {
    // The session IS closed and the data IS gone. The state stays terminal, so
    // the next entry shows the notice again — annoying, not destructive.
    mockBearerRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(acknowledgeDeletionAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/login?deletion=completed");
    expect(console.error).toHaveBeenCalled();
  });

  it("uses the token captured BEFORE the sign-out to acknowledge", async () => {
    // acknowledge_deletion() derives the user from auth.uid(), so it needs a
    // session — and the cookie session is gone by then, on purpose.
    const { createBearerClient } =
      await import("@/shared/infrastructure/supabase/bearer-client");

    await expect(acknowledgeDeletionAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(createBearerClient).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it("refuses to touch a live account that has no finalized deletion", async () => {
    stateResolves({ state: "ACTIVE" });

    await expect(acknowledgeDeletionAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockBearerRpc).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/app");
  });

  it("refuses someone merely inside the grace window", async () => {
    stateResolves({
      state: "GRACE_PERIOD",
      requested_at: "2026-07-01T10:00:00.000Z",
      ends_at: "2026-07-31T10:00:00.000Z",
    });

    await expect(acknowledgeDeletionAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/app");
  });

  it("sends an anonymous caller to login with no side effects", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(acknowledgeDeletionAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("does nothing and says so when the lifecycle read fails", async () => {
    // Fail closed, and stay put: redirecting to /app would bounce off the (app)
    // layout straight back here.
    stateResolves(null, { message: "boom" });

    const state = await acknowledgeDeletionAction();

    expect(state.error).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockBearerRpc).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("does not sign anyone out when there is no access token to acknowledge with", async () => {
    // Without the token the acknowledgement can never land and the person would
    // be wedged on the notice forever. Better to fail before closing anything.
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const state = await acknowledgeDeletionAction();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(state.error).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
