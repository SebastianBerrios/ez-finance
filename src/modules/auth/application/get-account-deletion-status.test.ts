import { describe, expect, it, vi } from "vitest";

import { GracePeriod } from "@/modules/auth/domain/grace-period";
import { err, ok } from "@/shared/domain/result";

import { getAccountDeletionStatus } from "./get-account-deletion-status";
import { type DeletionPort } from "./ports/deletion-port";

const USER_ID = "user-1";

function makeDeletionPort(overrides: Partial<DeletionPort> = {}): DeletionPort {
  return {
    getState: vi.fn().mockResolvedValue(ok({ state: "ACTIVE" })),
    request: vi.fn(),
    cancel: vi.fn(),
    acknowledge: vi.fn(),
    ...overrides,
  };
}

describe("getAccountDeletionStatus", () => {
  it("returns the ACTIVE status from the port", async () => {
    const deletion = makeDeletionPort();

    const result = await getAccountDeletionStatus(
      { userId: USER_ID },
      { deletion },
    );

    expect(deletion.getState).toHaveBeenCalledWith(USER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("ACTIVE");
  });

  it("passes the pending grace period through untouched", async () => {
    const grace = GracePeriod.between(
      new Date("2026-07-25T10:00:00.000Z"),
      new Date("2026-08-24T10:00:00.000Z"),
    );
    const deletion = makeDeletionPort({
      getState: vi.fn().mockResolvedValue(ok({ state: "GRACE_PERIOD", grace })),
    });

    const result = await getAccountDeletionStatus(
      { userId: USER_ID },
      { deletion },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("GRACE_PERIOD");
      expect(result.value.grace?.endsAt.toISOString()).toBe(
        "2026-08-24T10:00:00.000Z",
      );
    }
  });

  it("propagates the port error unchanged", async () => {
    const deletion = makeDeletionPort({
      getState: vi.fn().mockResolvedValue(err({ kind: "SessionExpired" })),
    });

    const result = await getAccountDeletionStatus(
      { userId: USER_ID },
      { deletion },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
  });
});
