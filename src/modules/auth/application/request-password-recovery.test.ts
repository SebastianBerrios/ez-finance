import { describe, expect, it, vi } from "vitest";

import { ok, err } from "@/shared/domain/result";

import { type AuthPort, type AuthUserRef, type SessionRef } from "./ports/auth-port";
import { requestPasswordRecovery } from "./request-password-recovery";

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

describe("requestPasswordRecovery use case", () => {
  it("ALWAYS returns ok(void) for a valid email — even if the port errors", async () => {
    const auth = makeFakeAuthPort({
      requestPasswordRecovery: vi.fn().mockResolvedValue(err({ kind: "Unavailable" })),
    });
    const result = await requestPasswordRecovery({ email: "anyone@example.com" }, { auth });
    expect(result.ok).toBe(true);
  });

  it("ALWAYS returns ok(void) when the email is not registered (non-enumeration)", async () => {
    const auth = makeFakeAuthPort({
      requestPasswordRecovery: vi.fn().mockResolvedValue(ok(undefined)),
    });
    const result = await requestPasswordRecovery({ email: "notfound@example.com" }, { auth });
    expect(result.ok).toBe(true);
  });

  it("ALWAYS returns ok(void) even for an invalid email format (non-enumeration)", async () => {
    const auth = makeFakeAuthPort();
    const result = await requestPasswordRecovery({ email: "not-an-email" }, { auth });
    expect(result.ok).toBe(true);
  });

  it("does not propagate port errors — returns generic ok regardless", async () => {
    const auth = makeFakeAuthPort({
      requestPasswordRecovery: vi.fn().mockResolvedValue(err({ kind: "AuthenticationFailed" })),
    });
    const result = await requestPasswordRecovery({ email: "google@example.com" }, { auth });
    expect(result.ok).toBe(true);
  });

  it("returns generic ok even when the port THROWS (rejects) — exception safety", async () => {
    const auth = makeFakeAuthPort({
      requestPasswordRecovery: vi
        .fn()
        .mockRejectedValue(new Error("network exploded")),
    });
    const result = await requestPasswordRecovery({ email: "boom@example.com" }, { auth });
    expect(result.ok).toBe(true);
  });
});
