import { describe, expect, it, vi } from "vitest";

import { GracePeriod } from "@/modules/auth/domain/grace-period";
import { ok, err } from "@/shared/domain/result";

import { type AuthPort, type AuthUserRef, type SessionRef } from "./ports/auth-port";
import { type DeletionPort } from "./ports/deletion-port";
import { requestAccountDeletion } from "./request-account-deletion";

const fakeGracePeriod = GracePeriod.from(new Date());

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

function makeFakeDeletionPort(overrides: Partial<DeletionPort> = {}): DeletionPort {
  return {
    getState: vi.fn().mockResolvedValue(ok("none")),
    request: vi.fn().mockResolvedValue(ok(fakeGracePeriod)),
    cancel: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

describe("requestAccountDeletion use case", () => {
  it("returns ok(GracePeriod) when deletion request succeeds", async () => {
    const deletion = makeFakeDeletionPort();
    const auth = makeFakeAuthPort();
    const result = await requestAccountDeletion({ userId: "u1" }, { deletion, auth });
    expect(result.ok).toBe(true);
    expect(deletion.request).toHaveBeenCalledWith("u1");
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("propagates deletion port error (e.g. sole-owner of shared workspace)", async () => {
    const deletion = makeFakeDeletionPort({
      request: vi.fn().mockResolvedValue(err({ kind: "ConflictOrRejected" })),
    });
    const auth = makeFakeAuthPort();
    const result = await requestAccountDeletion({ userId: "u1" }, { deletion, auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
