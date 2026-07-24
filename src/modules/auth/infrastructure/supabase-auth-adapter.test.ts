// supabase-auth-adapter.test.ts — unit tests for OAuth methods
// Mocks the Supabase client so no live server is needed.
// Tests initiateGoogleLogin and completeOAuth on SupabaseAuthAdapter.
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted ensures these are available when vi.mock factory runs (hoisted).
// ---------------------------------------------------------------------------
const { mockSignInWithOAuth, mockExchangeCodeForSession, mockGetUser } =
  vi.hoisted(() => ({
    mockSignInWithOAuth: vi.fn(),
    mockExchangeCodeForSession: vi.fn(),
    mockGetUser: vi.fn(),
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
    },
  }),
}));

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
