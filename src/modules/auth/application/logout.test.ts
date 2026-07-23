import { describe, expect, it, vi } from "vitest";

import { ok } from "@/shared/domain/result";

import { logout } from "./logout";
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

describe("logout use case", () => {
  it("delegates to auth.logout and returns ok", async () => {
    const auth = makeFakeAuthPort();
    const result = await logout({ auth });
    expect(result.ok).toBe(true);
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("propagates port errors", async () => {
    const auth = makeFakeAuthPort({
      logout: vi.fn().mockResolvedValue({ ok: false, error: { kind: "SessionExpired" } }),
    });
    const result = await logout({ auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
  });
});
