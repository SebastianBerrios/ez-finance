// supabase-auth-adapter.test.ts — unit tests for OAuth methods
// Mocks the Supabase client so no live server is needed.
// Tests initiateGoogleLogin and completeOAuth on SupabaseAuthAdapter.
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted ensures these are available when vi.mock factory runs (hoisted).
// ---------------------------------------------------------------------------
const {
  mockSignInWithOAuth,
  mockExchangeCodeForSession,
  mockGetUser,
  mockSignOut,
  mockUpdateUser,
} = vi.hoisted(() => ({
  mockSignInWithOAuth: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockUpdateUser: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @/shared/infrastructure/supabase/server so tests run in node env
// without needing cookies() or a live Supabase project.
// ---------------------------------------------------------------------------
vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
      getUser: mockGetUser,
      signOut: mockSignOut,
      updateUser: mockUpdateUser,
    },
  }),
}));

import { makePassword } from "@/modules/auth/domain/password";

import { SupabaseAuthAdapter } from "./supabase-auth-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAdapter() {
  return new SupabaseAuthAdapter();
}

// ---------------------------------------------------------------------------
// initiateGoogleLogin
// ---------------------------------------------------------------------------
describe("SupabaseAuthAdapter.initiateGoogleLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok({ url }) when signInWithOAuth succeeds", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: "https://accounts.google.com/o/oauth2/auth?..." },
      error: null,
    });

    const adapter = makeAdapter();
    const result = await adapter.initiateGoogleLogin(
      "https://example.com/auth/callback",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toMatch(/accounts\.google\.com/);
    }
  });

  it("calls signInWithOAuth with provider google and correct redirectTo", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: "https://accounts.google.com/auth" },
      error: null,
    });

    const adapter = makeAdapter();
    const redirectTo = "https://myapp.com/auth/callback";
    await adapter.initiateGoogleLogin(redirectTo);

    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({ redirectTo }),
      }),
    );
  });

  it("calls signInWithOAuth with skipBrowserRedirect: true", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: "https://accounts.google.com/auth" },
      error: null,
    });

    const adapter = makeAdapter();
    await adapter.initiateGoogleLogin("https://myapp.com/auth/callback");

    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ skipBrowserRedirect: true }),
      }),
    );
  });

  it("returns err(Unavailable) when signInWithOAuth returns error", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: { code: "unknown_error", message: "something failed" },
    });

    const adapter = makeAdapter();
    const result = await adapter.initiateGoogleLogin("https://myapp.com/auth/callback");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Generic error — no Supabase detail leaked
      expect(["Unavailable", "AuthenticationFailed"]).toContain(result.error.kind);
    }
  });

  it("returns err when url is null (OAuth not configured)", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: null,
    });

    const adapter = makeAdapter();
    const result = await adapter.initiateGoogleLogin("https://myapp.com/auth/callback");

    expect(result.ok).toBe(false);
  });

  it("returns err(Unavailable) on thrown exception", async () => {
    mockSignInWithOAuth.mockRejectedValueOnce(new Error("network failure"));

    const adapter = makeAdapter();
    const result = await adapter.initiateGoogleLogin("https://myapp.com/auth/callback");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("Unavailable");
    }
  });

  it("does not leak Supabase error details in the returned error", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: { code: "provider_disabled", message: "Google provider not enabled" },
    });

    const adapter = makeAdapter();
    const result = await adapter.initiateGoogleLogin("https://myapp.com/auth/callback");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.error);
      expect(serialized).not.toContain("provider_disabled");
      expect(serialized).not.toContain("Google provider not enabled");
    }
  });
});

// ---------------------------------------------------------------------------
// logout — the scope is the whole point. mvp-lab shares auth.users across the
// fleet, so supabase-js's default "global" scope would revoke fast_route's and
// oasis's refresh tokens as a side effect of signing out of ez finance.
// ---------------------------------------------------------------------------
describe("SupabaseAuthAdapter.logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("forwards the requested scope to signOut", async () => {
    await makeAdapter().logout("local");

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("never calls signOut without an explicit scope", async () => {
    await makeAdapter().logout("others");

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    const [options] = mockSignOut.mock.calls[0] as [unknown];
    expect(options).toEqual({ scope: "others" });
  });

  it("maps a signOut failure to a domain error", async () => {
    mockSignOut.mockResolvedValueOnce({
      error: { code: "unknown_error", message: "boom" },
    });

    const result = await makeAdapter().logout("local");

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// changePassword — the ONE place where a fleet-wide revocation is intentional.
// Everywhere else sign-out is "local", because mvp-lab shares auth.users. A
// password protects that SHARED identity, so leaving the other sessions alive
// after a change (often made because the old one was compromised) would defeat
// the point. It must still go through the port: the scope is a decision, not
// something a raw signOut() call gets to make on its own.
// ---------------------------------------------------------------------------
describe("SupabaseAuthAdapter.changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUser.mockResolvedValue({ error: null });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("revokes the other sessions through the port with an explicit scope", async () => {
    const adapter = makeAdapter();
    const logoutSpy = vi.spyOn(adapter, "logout");

    const result = await adapter.changePassword(null, makePassword("N3wPassw0rd!"));

    expect(result.ok).toBe(true);
    expect(logoutSpy).toHaveBeenCalledWith("others");
  });

  it("keeps THIS session alive", async () => {
    // "others", never "global": the person changing their password must not be
    // signed out of the browser they are doing it in.
    await makeAdapter().changePassword(null, makePassword("N3wPassw0rd!"));

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("does not revoke anything when the password change itself failed", async () => {
    mockUpdateUser.mockResolvedValue({
      error: { code: "weak_password", message: "too weak" },
    });

    const result = await makeAdapter().changePassword(
      null,
      makePassword("short"),
    );

    expect(result.ok).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("reports success but logs when the revocation fails", async () => {
    // The password IS changed. Failing the whole operation would tell the user
    // to try again with a password that already works. But a silent failure
    // leaves stolen sessions alive on a credential the user believes rotated.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSignOut.mockResolvedValue({ error: { message: "boom" } });

    const result = await makeAdapter().changePassword(
      null,
      makePassword("N3wPassw0rd!"),
    );

    expect(result.ok).toBe(true);
    expect(console.error).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// completeOAuth
// ---------------------------------------------------------------------------
describe("SupabaseAuthAdapter.completeOAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok({ userId, accessToken }) on successful code exchange", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: "user-123" },
          access_token: "token-abc",
        },
      },
      error: null,
    });

    const adapter = makeAdapter();
    const result = await adapter.completeOAuth("valid-code-xyz");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe("user-123");
      expect(result.value.accessToken).toBe("token-abc");
    }
  });

  it("calls exchangeCodeForSession with the provided code", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: "user-abc" },
          access_token: "tok-xyz",
        },
      },
      error: null,
    });

    const adapter = makeAdapter();
    await adapter.completeOAuth("my-auth-code");

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("my-auth-code");
  });

  it("returns err(AuthenticationFailed) when exchange returns an error", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: { code: "invalid_credentials", message: "bad code" },
    });

    const adapter = makeAdapter();
    const result = await adapter.completeOAuth("bad-code");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Maps to AuthenticationFailed (generic, non-enumerating)
      expect(["AuthenticationFailed", "Unavailable"]).toContain(result.error.kind);
    }
  });

  it("returns err when session is null after exchange (no error from Supabase)", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    const adapter = makeAdapter();
    const result = await adapter.completeOAuth("code-with-null-session");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("AuthenticationFailed");
    }
  });

  it("returns err(Unavailable) on thrown exception", async () => {
    mockExchangeCodeForSession.mockRejectedValueOnce(new Error("network error"));

    const adapter = makeAdapter();
    const result = await adapter.completeOAuth("any-code");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("Unavailable");
    }
  });

  it("does not leak Supabase error details in the returned error", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: { code: "some_internal_code", message: "provider rejected the code" },
    });

    const adapter = makeAdapter();
    const result = await adapter.completeOAuth("any-code");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.error);
      expect(serialized).not.toContain("some_internal_code");
      expect(serialized).not.toContain("provider rejected");
    }
  });
});
