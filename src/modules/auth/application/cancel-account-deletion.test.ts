import { describe, expect, it, vi } from "vitest";

import { ok, err } from "@/shared/domain/result";

import { cancelAccountDeletion } from "./cancel-account-deletion";
import { type DeletionPort } from "./ports/deletion-port";

function makeFakeDeletionPort(overrides: Partial<DeletionPort> = {}): DeletionPort {
  return {
    getState: vi.fn().mockResolvedValue(ok("pending")),
    request: vi.fn().mockResolvedValue(ok(undefined)),
    cancel: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

describe("cancelAccountDeletion use case", () => {
  it("returns ok when cancellation succeeds", async () => {
    const deletion = makeFakeDeletionPort();
    const result = await cancelAccountDeletion({ userId: "u1" }, { deletion });
    expect(result.ok).toBe(true);
    expect(deletion.cancel).toHaveBeenCalledWith("u1");
  });

  it("propagates error when grace period has expired", async () => {
    const deletion = makeFakeDeletionPort({
      cancel: vi.fn().mockResolvedValue(err({ kind: "ConflictOrRejected" })),
    });
    const result = await cancelAccountDeletion({ userId: "u1" }, { deletion });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
  });
});
