// current-user.test.ts — contract of the memoized session read.
//
// NOTE ON WHAT IS NOT TESTED HERE: React.cache() only deduplicates inside a
// React request scope. Called from a plain Node test there is no scope, so the
// helper runs its body on every call and the memoization is invisible. The
// deduplication is exercised for real by the (app) layout + page render, which
// the e2e suite drives. What IS worth pinning here is the shape callers depend
// on and that the Auth error is propagated rather than swallowed.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }));

vi.mock("./server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

import { getAuthenticatedUser } from "./current-user";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAuthenticatedUser", () => {
  it("returns the server-validated user", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u-1" } },
      error: null,
    });

    const { user, error } = await getAuthenticatedUser();

    expect(user).toEqual({ id: "u-1" });
    expect(error).toBeNull();
  });

  it("returns a null user instead of throwing when there is no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const { user } = await getAuthenticatedUser();

    expect(user).toBeNull();
  });

  it("returns the very client that validated the session", async () => {
    // getUser() can refresh the access token, and the refreshed token lives on
    // the client that performed the call. A caller that validates here and then
    // builds a SECOND client for its RPCs sends the stale token.
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u-1" } },
      error: null,
    });

    const { supabase } = await getAuthenticatedUser();

    expect(supabase).toBeDefined();
    expect(supabase.auth.getUser).toBe(mockGetUser);
  });

  it("propagates the Auth error so callers can tell 'expired' from 'unavailable'", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "jwt_expired" },
    });

    const { error } = await getAuthenticatedUser();

    expect(error).toEqual({ message: "jwt_expired" });
  });
});
