import { describe, expect, it, vi } from "vitest";

import { type AuthError } from "@/modules/auth/domain/auth-error";
import { ok, err } from "@/shared/domain/result";

import { changeEmail } from "./change-email";
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

describe("changeEmail use case", () => {
  it("returns ok when new email is valid", async () => {
    const auth = makeFakeAuthPort();
    const result = await changeEmail({ next: "newemail@example.com" }, { auth });
    expect(result.ok).toBe(true);
    expect(auth.changeEmail).toHaveBeenCalledOnce();
  });

  it("returns err(InvalidEmail) without calling port when email is malformed", async () => {
    const auth = makeFakeAuthPort();
    const result = await changeEmail({ next: "bad-email" }, { auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    expect(auth.changeEmail).not.toHaveBeenCalled();
  });

  it("non-enumeration: taken email returns an error carrying ONLY {kind} — no 'email taken' or existence-revealing payload", async () => {
    const auth = makeFakeAuthPort({
      changeEmail: vi
        .fn()
        .mockResolvedValue(err({ kind: "ConflictOrRejected" } satisfies AuthError)),
    });
    const result = await changeEmail({ next: "taken@example.com" }, { auth });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ConflictOrRejected");
      // The propagated error must not leak the target address or any detail.
      expect(Object.keys(result.error)).toEqual(["kind"]);
      expect(JSON.stringify(result.error)).not.toContain("taken@example.com");
    }
  });
});
