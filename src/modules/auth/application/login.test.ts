import { describe, expect, it, vi } from "vitest";

import { ok, err } from "@/shared/domain/result";

import { login } from "./login";
import { type AuthPort, type AuthUserRef, type SessionRef } from "./ports/auth-port";

function makeFakeAuthPort(overrides: Partial<AuthPort> = {}): AuthPort {
  return {
    register: vi.fn().mockResolvedValue(ok(undefined)),
    login: vi.fn().mockResolvedValue(ok({ userId: "u1", accessToken: "tok" } satisfies SessionRef)),
    initiateGoogleLogin: vi.fn().mockResolvedValue(ok({ url: "https://google.com" })),
    completeOAuth: vi.fn().mockResolvedValue(ok({ userId: "u1", accessToken: "tok" } satisfies SessionRef)),
    logout: vi.fn().mockResolvedValue(ok(undefined)),
    requestPasswordRecovery: vi.fn().mockResolvedValue(ok(undefined)),
    changePassword: vi.fn().mockResolvedValue(ok(undefined)),
    changeEmail: vi.fn().mockResolvedValue(ok(undefined)),
    getCurrentUser: vi.fn().mockResolvedValue(ok({ id: "u1", email: "a@b.com" } satisfies AuthUserRef)),
    ...overrides,
  };
}

describe("login use case", () => {
  it("returns ok(SessionRef) on valid credentials", async () => {
    const session: SessionRef = { userId: "u1", accessToken: "tok" };
    const auth = makeFakeAuthPort({
      login: vi.fn().mockResolvedValue(ok(session)),
    });
    const result = await login({ email: "user@example.com", password: "Password1!" }, { auth });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe("u1");
    }
  });

  it("returns err(InvalidEmail) when email is malformed, without calling auth.login", async () => {
    const auth = makeFakeAuthPort();
    const result = await login({ email: "bademail", password: "Password1!" }, { auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("returns err(AuthenticationFailed) when adapter signals bad credentials", async () => {
    const auth = makeFakeAuthPort({
      login: vi.fn().mockResolvedValue(err({ kind: "AuthenticationFailed" })),
    });
    const result = await login({ email: "user@example.com", password: "Password1!" }, { auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AuthenticationFailed");
  });

  it("returns the GENERIC AuthenticationFailed for an unconfirmed email — identical to not-found/wrong-password (no enumeration oracle)", async () => {
    // The adapter collapses email_not_confirmed to AuthenticationFailed via
    // classify(); login must NOT surface a distinct EmailNotConfirmed variant,
    // otherwise an attacker could distinguish existing-unconfirmed from not-found.
    const auth = makeFakeAuthPort({
      login: vi.fn().mockResolvedValue(err({ kind: "AuthenticationFailed" })),
    });
    const result = await login({ email: "user@example.com", password: "Password1!" }, { auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AuthenticationFailed");
  });
});
