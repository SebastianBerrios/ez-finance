import { describe, expect, it, vi } from "vitest";

import { ok, err } from "@/shared/domain/result";

import { changePassword } from "./change-password";
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

describe("changePassword use case", () => {
  it("returns ok when new password passes policy", async () => {
    const auth = makeFakeAuthPort();
    const result = await changePassword({ next: "NewPassword1!" }, { auth });
    expect(result.ok).toBe(true);
    expect(auth.changePassword).toHaveBeenCalledOnce();
  });

  it("returns err(WeakPassword) without calling port when new password is weak", async () => {
    const auth = makeFakeAuthPort();
    const result = await changePassword({ next: "weak" }, { auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it("propagates port errors", async () => {
    const auth = makeFakeAuthPort({
      changePassword: vi.fn().mockResolvedValue(err({ kind: "ReauthRequired" })),
    });
    const result = await changePassword({ next: "NewPassword1!" }, { auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ReauthRequired");
  });

  it("passes current password to port when provided", async () => {
    const auth = makeFakeAuthPort();
    const result = await changePassword({ current: "OldPassword1!", next: "NewPassword1!" }, { auth });
    expect(result.ok).toBe(true);
    expect(auth.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.any(Function) }),
      expect.objectContaining({ value: expect.any(Function) }),
    );
  });
});
