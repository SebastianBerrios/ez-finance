import { describe, expect, it, vi } from "vitest";

import { type AuthError } from "@/modules/auth/domain/auth-error";
import { ok, err } from "@/shared/domain/result";

import {
  type AuthPort,
  type AuthUserRef,
  type SessionRef,
} from "./ports/auth-port";
import { register } from "./register";

// Fake implementation of AuthPort for testing
function makeFakeAuthPort(overrides: Partial<AuthPort> = {}): AuthPort {
  return {
    register: vi.fn().mockResolvedValue(ok(undefined)),
    login: vi
      .fn()
      .mockResolvedValue(
        ok({ userId: "u1", accessToken: "tok" } satisfies SessionRef),
      ),
    initiateGoogleLogin: vi
      .fn()
      .mockResolvedValue(ok({ url: "https://google.com" })),
    completeOAuth: vi
      .fn()
      .mockResolvedValue(
        ok({ userId: "u1", accessToken: "tok" } satisfies SessionRef),
      ),
    logout: vi.fn().mockResolvedValue(ok(undefined)),
    requestPasswordRecovery: vi.fn().mockResolvedValue(ok(undefined)),
    changePassword: vi.fn().mockResolvedValue(ok(undefined)),
    changeEmail: vi.fn().mockResolvedValue(ok(undefined)),
    getCurrentUser: vi
      .fn()
      .mockResolvedValue(
        ok({ id: "u1", email: "a@b.com" } satisfies AuthUserRef),
      ),
    ...overrides,
  };
}

describe("register use case", () => {
  it("returns ok when email and password are valid", async () => {
    const auth = makeFakeAuthPort();
    const result = await register(
      { email: "user@example.com", password: "Password1!" },
      { auth },
    );
    expect(result.ok).toBe(true);
    expect(auth.register).toHaveBeenCalledOnce();
  });

  it("returns err(InvalidEmail) without calling auth.register when email is invalid", async () => {
    const auth = makeFakeAuthPort();
    const result = await register(
      { email: "bad-email", password: "Password1!" },
      { auth },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("returns err(WeakPassword) without calling auth.register when password is weak", async () => {
    const auth = makeFakeAuthPort();
    const result = await register(
      { email: "user@example.com", password: "weak" },
      { auth },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("non-enumeration: existing email returns ok (fake port simulates non-enumerating adapter)", async () => {
    const auth = makeFakeAuthPort({
      register: vi.fn().mockResolvedValue(ok(undefined)),
    });
    const result = await register(
      { email: "existing@example.com", password: "Password1!" },
      { auth },
    );
    expect(result.ok).toBe(true);
  });

  it("non-enumeration: when the adapter rejects (ConflictOrRejected) the error carries ONLY {kind} — no existence-revealing payload", async () => {
    // A real adapter collapses an already-registered email into an opaque
    // AuthError. Assert the use case propagates NOTHING beyond the kind
    // discriminant — no email, message, provider, or detail field that
    // could confirm the account exists.
    const auth = makeFakeAuthPort({
      register: vi
        .fn()
        .mockResolvedValue(
          err({ kind: "ConflictOrRejected" } satisfies AuthError),
        ),
    });
    const result = await register(
      { email: "existing@example.com", password: "Password1!" },
      { auth },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ConflictOrRejected");
      expect(Object.keys(result.error)).toEqual(["kind"]);
      expect(JSON.stringify(result.error)).not.toContain(
        "existing@example.com",
      );
    }
  });

  it("validates email before password — invalid email short-circuits", async () => {
    const auth = makeFakeAuthPort();
    const result = await register(
      { email: "bademail", password: "weak" },
      { auth },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
  });
});
