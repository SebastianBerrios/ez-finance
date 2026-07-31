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
  mockSignUp,
  mockResetPasswordForEmail,
  mockGetRequestOrigin,
} = vi.hoisted(() => ({
  mockSignInWithOAuth: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockSignUp: vi.fn(),
  mockResetPasswordForEmail: vi.fn(),
  mockGetRequestOrigin: vi.fn(),
}));

vi.mock("@/shared/infrastructure/http/origin", () => ({
  getRequestOrigin: mockGetRequestOrigin,
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
      signUp: mockSignUp,
      resetPasswordForEmail: mockResetPasswordForEmail,
    },
  }),
}));

import { type Email } from "@/modules/auth/domain/email";
import { makePassword } from "@/modules/auth/domain/password";

import { SupabaseAuthAdapter } from "./supabase-auth-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAdapter() {
  return new SupabaseAuthAdapter();
}

function makeEmail(value: string): Email {
  return { value };
}

// ---------------------------------------------------------------------------
// Transactional-email redirects.
//
// mvp-lab is ONE Supabase project shared by the fleet, so its Site URL is a
// single default that belongs to nobody. Every link Supabase mails out —
// signup confirmation, password recovery, email change — must carry an
// explicit redirect built from the origin of the request that triggered it,
// or the mail lands on whichever app happens to own the Site URL.
//
// Recovery and email-change send a link REGARDLESS of enable_confirmations,
// so these are not conditional on the signup-confirmation setting.
// ---------------------------------------------------------------------------
describe("SupabaseAuthAdapter transactional-email redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestOrigin.mockResolvedValue("https://ez-finance.vercel.app");
    mockSignUp.mockResolvedValue({ error: null });
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    mockUpdateUser.mockResolvedValue({ error: null });
  });

  it("register points the confirmation link at this deployment's callback", async () => {
    await makeAdapter().register(
      makeEmail("someone@example.com"),
      makePassword("N3wPassw0rd!"),
    );

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://ez-finance.vercel.app/auth/callback",
        }),
      }),
    );
  });

  it("register discards a session signUp hands back (enumeration tell)", async () => {
    // With enable_confirmations OFF, signUp returns a SESSION for a new address
    // and nothing for one that already exists. register.action redirects to
    // /check-email either way, so that session is the remaining difference an
    // attacker can read: reaching /app afterwards proves the address was new.
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: "tok", user: { id: "u1" } } },
      error: null,
    });

    const result = await makeAdapter().register(
      makeEmail("someone@example.com"),
      makePassword("N3wPassw0rd!"),
    );

    expect(result.ok).toBe(true);
    // "local" — never global. The fleet shares one auth.users row, so signing a
    // person out of the other apps is not this flow's business.
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("register does not sign out when signUp issued no session", async () => {
    // The confirmations-ON path, and the already-registered path. Nothing to
    // discard, so nothing should be revoked.
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });

    await makeAdapter().register(
      makeEmail("someone@example.com"),
      makePassword("N3wPassw0rd!"),
    );

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("requestPasswordRecovery points the link at this deployment's exchange route", async () => {
    await makeAdapter().requestPasswordRecovery(makeEmail("someone@example.com"));

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      "someone@example.com",
      expect.objectContaining({
        redirectTo: "https://ez-finance.vercel.app/auth/reset-password",
      }),
    );
  });

  it("changeEmail points the confirmation link at this deployment's callback", async () => {
    await makeAdapter().changeEmail(makeEmail("new@example.com"));

    expect(mockUpdateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com" }),
      expect.objectContaining({
        emailRedirectTo: "https://ez-finance.vercel.app/auth/callback",
      }),
    );
  });

  it("follows the request origin instead of hardcoding a deployment", async () => {
    // Same code must work from localhost, a Vercel preview, and production —
    // hardcoding any one of them re-creates the shared-Site-URL bug.
    mockGetRequestOrigin.mockResolvedValue("http://localhost:3000");

    await makeAdapter().requestPasswordRecovery(makeEmail("someone@example.com"));

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      "someone@example.com",
      expect.objectContaining({
        redirectTo: "http://localhost:3000/auth/reset-password",
      }),
    );
  });

  it("still reports success generically when recovery cannot resolve an origin", async () => {
    // requestPasswordRecovery must never become an enumeration oracle, and it
    // must not start throwing just because the header read failed.
    mockGetRequestOrigin.mockRejectedValue(new Error("no request scope"));

    const result = await makeAdapter().requestPasswordRecovery(
      makeEmail("someone@example.com"),
    );

    expect(result.ok).toBe(true);
  });
});

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
