// logout.action.test.ts — the ordinary "Cerrar sesión" action.
//
// It used to do `await logout(...); redirect("/login")` and throw the Result
// away. On failure the session survives, the middleware bounces the still
// authenticated user off /login straight back to /app, and the user is left
// convinced they signed out. The deletion path was fixed for exactly this in
// round 1 — and its error copy tells people to "cerrala manualmente desde
// Cerrar sesión", routing them into this one.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockSignOut } = vi.hoisted(() => ({ mockSignOut: vi.fn() }));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { signOut: mockSignOut },
  }),
}));

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(() => {
    // next/navigation's redirect() throws NEXT_REDIRECT; the real control flow
    // matters here, because "returned a state" and "navigated away" are the two
    // outcomes under test.
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import { logoutAction } from "./logout.action";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockSignOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("logoutAction", () => {
  it("signs out of this browser only and redirects to login", async () => {
    // "local": mvp-lab shares auth.users with the rest of the fleet.
    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("surfaces an error instead of redirecting when the sign-out fails", async () => {
    mockSignOut.mockResolvedValue({ error: { message: "boom" } });

    const state = await logoutAction();

    expect(state.error).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("logs the failure", async () => {
    mockSignOut.mockResolvedValue({ error: { message: "boom" } });

    await logoutAction();

    expect(console.error).toHaveBeenCalled();
  });

  it("leaks no provider detail in the message it shows", async () => {
    mockSignOut.mockResolvedValue({
      error: { message: "PGRST301 upstream exploded", code: "PGRST301" },
    });

    const state = await logoutAction();

    expect(state.error).not.toContain("PGRST301");
  });
});
