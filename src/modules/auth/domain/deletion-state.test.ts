import { describe, expect, it } from "vitest";

import {
  cancelDeletion,
  executeDeletion,
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

describe("DeletionState machine", () => {
  describe("requestDeletion", () => {
    it("transitions none → pending", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = requestDeletion("none", grace);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("pending");
    });

    it("transitions cancelled → pending (new request after cancellation is valid)", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = requestDeletion("cancelled", grace);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("pending");
    });

    it("rejects transition from pending → pending", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = requestDeletion("pending", grace);
      expect(result.ok).toBe(false);
    });

    it("rejects transition from executed → pending", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = requestDeletion("executed", grace);
      expect(result.ok).toBe(false);
    });
  });

  describe("cancelDeletion", () => {
    it("transitions pending → cancelled when grace period has not expired", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = cancelDeletion("pending", grace, NOW);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("cancelled");
    });

    it("rejects cancellation when grace period has expired", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = cancelDeletion("pending", grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects cancellation from 'none' state", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = cancelDeletion("none" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects cancellation from 'executed' state", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = cancelDeletion("executed" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });
  });

  describe("executeDeletion", () => {
    it("transitions pending → executed when grace period has expired", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = executeDeletion("pending", grace, NOW);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("executed");
    });

    it("rejects execution when grace period has NOT expired yet", () => {
      const grace = gracePeriodEndingAt(FUTURE);
      const result = executeDeletion("pending", grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects execution from 'none' state", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = executeDeletion("none" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });

    it("rejects execution from 'cancelled' state", () => {
      const grace = gracePeriodEndingAt(PAST);
      const result = executeDeletion("cancelled" as DeletionState, grace, NOW);
      expect(result.ok).toBe(false);
    });
  });
});
