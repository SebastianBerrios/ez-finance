import { describe, expect, it, vi } from "vitest";

import { GracePeriod } from "@/modules/auth/domain/grace-period";
import { ok, err } from "@/shared/domain/result";

import {
  type AuthPort,
  type AuthUserRef,
  type SessionRef,
} from "./ports/auth-port";
import { type DeletionPort } from "./ports/deletion-port";
import { requestAccountDeletion } from "./request-account-deletion";

const fakeGracePeriod = GracePeriod.from(new Date());

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

function makeFakeDeletionPort(
  overrides: Partial<DeletionPort> = {},
): DeletionPort {
  return {
    getState: vi.fn().mockResolvedValue(ok("ACTIVE")),
    request: vi.fn().mockResolvedValue(ok(fakeGracePeriod)),
    cancel: vi.fn().mockResolvedValue(ok(undefined)),
    acknowledge: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

describe("requestAccountDeletion use case", () => {
  it("returns ok with the grace window when the deletion request succeeds", async () => {
    const deletion = makeFakeDeletionPort();
    const auth = makeFakeAuthPort();
    const result = await requestAccountDeletion(
      { userId: "u1" },
      { deletion, auth },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.grace).toBe(fakeGracePeriod);
      expect(result.value.signedOut).toBe(true);
    }
    expect(deletion.request).toHaveBeenCalledWith("u1");
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("closes only this browser's session, not the whole fleet", async () => {
    // The auth.users row is shared with fast_route and oasis in mvp-lab, so a
    // "global" sign-out here would be cross-app damage.
    const deletion = makeFakeDeletionPort();
    const auth = makeFakeAuthPort();
    await requestAccountDeletion({ userId: "u1" }, { deletion, auth });
    expect(auth.logout).toHaveBeenCalledWith("local");
  });

  it("reports signedOut: false when the sign-out fails, keeping the request", async () => {
    // The grace window is already open in the database — a failed sign-out must
    // not look like a failed request. The caller needs to know it cannot
    // redirect to an auth page (the middleware would bounce it back).
    const deletion = makeFakeDeletionPort();
    const auth = makeFakeAuthPort({
      logout: vi.fn().mockResolvedValue(err({ kind: "Unavailable" })),
    });

    const result = await requestAccountDeletion(
      { userId: "u1" },
      { deletion, auth },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.signedOut).toBe(false);
      expect(result.value.grace).toBe(fakeGracePeriod);
    }
  });

  it("propagates a generic block from the deletion port without acting further", async () => {
    // NOTE: the sole-owner-of-shared-workspace rule is a GATED DB query living
    // in the deletion adapter (Fase 2/3), NOT pure use-case logic. This test
    // only covers that the use case forwards a generic ConflictOrRejected block
    // and does NOT proceed to close sessions when the port rejects.
    const deletion = makeFakeDeletionPort({
      request: vi.fn().mockResolvedValue(err({ kind: "ConflictOrRejected" })),
    });
    const auth = makeFakeAuthPort();
    const result = await requestAccountDeletion(
      { userId: "u1" },
      { deletion, auth },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
