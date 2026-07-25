import { describe, expect, it } from "vitest";

import { GracePeriod } from "./grace-period";

describe("GracePeriod value object", () => {
  const requestedAt = new Date("2024-01-01T00:00:00.000Z");
  const expectedEndsAt = new Date("2024-01-31T00:00:00.000Z"); // +30 days

  it("creates a GracePeriod with endsAt = requestedAt + 30 days", () => {
    const gp = GracePeriod.from(requestedAt);
    expect(gp.endsAt.getTime()).toBe(expectedEndsAt.getTime());
  });

  describe("isExpired()", () => {
    it("returns false when now is before endsAt", () => {
      const gp = GracePeriod.from(requestedAt);
      const before = new Date("2024-01-15T00:00:00.000Z");
      expect(gp.isExpired(before)).toBe(false);
    });

    it("returns true when now equals endsAt (boundary = expired)", () => {
      const gp = GracePeriod.from(requestedAt);
      expect(gp.isExpired(expectedEndsAt)).toBe(true);
    });

    it("returns true when now is after endsAt", () => {
      const gp = GracePeriod.from(requestedAt);
      const after = new Date("2024-02-15T00:00:00.000Z");
      expect(gp.isExpired(after)).toBe(true);
    });
  });

  describe("canReactivate()", () => {
    it("returns true when grace period has not expired", () => {
      const gp = GracePeriod.from(requestedAt);
      const before = new Date("2024-01-15T00:00:00.000Z");
      expect(gp.canReactivate(before)).toBe(true);
    });

    it("returns false when grace period has expired (exact boundary)", () => {
      const gp = GracePeriod.from(requestedAt);
      expect(gp.canReactivate(expectedEndsAt)).toBe(false);
    });

    it("returns false when now is after endsAt", () => {
      const gp = GracePeriod.from(requestedAt);
      const after = new Date("2024-03-01T00:00:00.000Z");
      expect(gp.canReactivate(after)).toBe(false);
    });
  });

  it("exposes requestedAt", () => {
    const gp = GracePeriod.from(requestedAt);
    expect(gp.requestedAt.getTime()).toBe(requestedAt.getTime());
  });

  // The persisted window is authoritative: a request stored with a different
  // deadline (window changed, clock skew) must be reconstructed as stored,
  // never recomputed from the local GRACE_DAYS constant.
  describe("between()", () => {
    it("keeps the given endsAt even when it differs from requestedAt + 30 days", () => {
      const endsAt = new Date("2024-01-08T00:00:00.000Z"); // +7 days
      const gp = GracePeriod.between(requestedAt, endsAt);

      expect(gp.requestedAt.getTime()).toBe(requestedAt.getTime());
      expect(gp.endsAt.getTime()).toBe(endsAt.getTime());
    });

    it("derives isExpired from the given endsAt", () => {
      const endsAt = new Date("2024-01-08T00:00:00.000Z");
      const gp = GracePeriod.between(requestedAt, endsAt);

      expect(gp.isExpired(new Date("2024-01-07T23:59:59.000Z"))).toBe(false);
      expect(gp.isExpired(endsAt)).toBe(true);
    });

    it("derives canReactivate from the given endsAt", () => {
      const endsAt = new Date("2024-01-08T00:00:00.000Z");
      const gp = GracePeriod.between(requestedAt, endsAt);

      expect(gp.canReactivate(new Date("2024-01-07T23:59:59.000Z"))).toBe(true);
      expect(gp.canReactivate(endsAt)).toBe(false);
    });
  });
});
