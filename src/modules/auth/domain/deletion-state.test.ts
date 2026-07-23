import { describe, expect, it } from "vitest";

import {
  cancelDeletion,
  executeDeletion,
  reactivateDeletion,
  requestDeletion,
  type DeletionState,
} from "./deletion-state";
import { GracePeriod } from "./grace-period";

const PAST = new Date("2020-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");
const NOW = new Date("2024-06-01T00:00:00.000Z");

function gracePeriodEndingAt(endsAt: Date): GracePeriod {
  // endsAt = requestedAt + 30 days => requestedAt = endsAt - 30 days
  const requestedAt = new Date(endsAt.getTime() - 30 * 24 * 60 * 60 * 1000);
  return GracePeriod.from(requestedAt);
}

describe("DeletionState machine (spec ACTIVE / GRACE_PERIOD / DELETED)", () => {
  describe("requestDeletion — ACTIVE → GRACE_PERIOD", () => {
    it("transitions ACTIVE → GRACE_PERIOD", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = requestDeletion("ACTIVE", grace);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("GRACE_PERIOD");
    });

    it("rejects double request from GRACE_PERIOD", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = requestDeletion("GRACE_PERIOD", grace);
      expect(result.ok).toBe(false);
    });

    it("rejects any request from DELETED (terminal)", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = requestDeletion("DELETED", grace);
      expect(result.ok).toBe(false);
    });
  });

  describe("cancelDeletion — GRACE_PERIOD → ACTIVE (user-initiated)", () => {
    it("transitions GRACE_PERIOD → ACTIVE when grace period has not expired", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = cancelDeletion("GRACE_PERIOD", grace, NOW);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("ACTIVE");
    });

    it("rejects cancellation when grace period has expired", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = cancelDeletion("GRACE_PERIOD", grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects double-cancel (from ACTIVE)", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = cancelDeletion("ACTIVE" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects cancellation after execution (from DELETED)", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = cancelDeletion("DELETED" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });
  });

  describe("reactivateDeletion — GRACE_PERIOD → ACTIVE (guarded by canReactivate)", () => {
    it("transitions GRACE_PERIOD → ACTIVE while the grace window can still reactivate", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = reactivateDeletion("GRACE_PERIOD", grace, NOW);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("ACTIVE");
    });

    it("rejects reactivation once the grace window can no longer reactivate (expired)", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = reactivateDeletion("GRACE_PERIOD", grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects reactivation from ACTIVE (nothing to reactivate)", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = reactivateDeletion("ACTIVE" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects reactivation from DELETED (terminal)", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = reactivateDeletion("DELETED" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });
  });

  describe("executeDeletion — GRACE_PERIOD → DELETED", () => {
    it("transitions GRACE_PERIOD → DELETED when grace period has expired", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = executeDeletion("GRACE_PERIOD", grace, NOW);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("DELETED");
    });

    it("rejects execution before the grace period expires", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = executeDeletion("GRACE_PERIOD", grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects execution from ACTIVE state", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = executeDeletion("ACTIVE" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects any transition FROM DELETED (terminal): execute", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = executeDeletion("DELETED" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });
  });
});
