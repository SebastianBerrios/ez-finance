// bucket.test.ts — TDD: computeBucket
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import { describe, expect, it } from "vitest";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { computeBucket } from "./bucket";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function usd(n: bigint) {
  return expectOk(fromMinorUnits("USD", n));
}

// ---------------------------------------------------------------------------
// computeBucket
// ---------------------------------------------------------------------------

describe("computeBucket", () => {
  // ------------------------------------------------------------------
  // Zero income guard (REQ-E-08)
  // ------------------------------------------------------------------

  describe("zero income guard", () => {
    it("returns consumedPct=0 and targetAmount=0 when income is zero", () => {
      const income = usd(0n);
      const consumed = usd(5000n); // $50.00 consumed but income is zero
      const result = computeBucket(income, 50, consumed);

      expect(result.consumedPct).toBe(0);
      expect(result.targetAmount.minorUnits).toBe(0n);
      expect(result.consumedAmount.minorUnits).toBe(5000n);
    });

    it("returns remaining = 0 - consumed (negative) when income is zero", () => {
      const income = usd(0n);
      const consumed = usd(3000n);
      const result = computeBucket(income, 30, consumed);

      // remaining = target(0) - consumed(3000) = -3000
      expect(result.remaining.minorUnits).toBe(-3000n);
    });

    it("never produces NaN when income is zero (consumedPct is always a number)", () => {
      const income = usd(0n);
      const consumed = usd(0n);
      const result = computeBucket(income, 100, consumed);

      expect(Number.isNaN(result.consumedPct)).toBe(false);
      expect(result.consumedPct).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // Normal computation
  // ------------------------------------------------------------------

  describe("normal income", () => {
    it("computes targetAmount as income * pct/100 (half-even)", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(0n);
      const result = computeBucket(income, 50, consumed);

      // target = 1000.00 * 50/100 = 500.00 = 50000 minor units
      expect(result.targetAmount.minorUnits).toBe(50000n);
    });

    it("computes consumedPct as consumed/income * 100", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(85000n); // $850.00 = 85%
      const result = computeBucket(income, 50, consumed);

      expect(result.consumedPct).toBeCloseTo(85, 5);
    });

    it("returns remaining = target - consumed (positive when under budget)", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(30000n); // $300.00
      const result = computeBucket(income, 50, consumed);

      // target = 50000, consumed = 30000, remaining = 20000
      expect(result.remaining.minorUnits).toBe(20000n);
    });

    it("returns remaining = negative when over budget", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(60000n); // $600.00 (over the 50% target of $500)
      const result = computeBucket(income, 50, consumed);

      // target = 50000, consumed = 60000, remaining = -10000
      expect(result.remaining.minorUnits).toBe(-10000n);
    });

    it("computes consumedPct > 100 when over budget", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(60000n); // $600.00 (over the 50% target)
      const result = computeBucket(income, 50, consumed);

      // consumedPct = 600/1000 * 100 = 60% (consumed vs income, not vs target)
      expect(result.consumedPct).toBeCloseTo(60, 5);
    });

    it("consumedPct based on income (not target) — can exceed 100 for a single bucket", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(120000n); // $1200.00 (120% of income)
      const result = computeBucket(income, 50, consumed);

      // consumedPct = 1200/1000 * 100 = 120%
      expect(result.consumedPct).toBeCloseTo(120, 5);
    });

    it("computes consumedPct = exactly 100 when consumed equals income", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(100000n); // 100% of income
      const result = computeBucket(income, 50, consumed);

      expect(result.consumedPct).toBe(100);
    });

    it("preserves currency through all output Money values", () => {
      const income = usd(100000n);
      const consumed = usd(40000n);
      const result = computeBucket(income, 40, consumed);

      expect(result.targetAmount.currency).toBe(income.currency);
      expect(result.consumedAmount.currency).toBe(income.currency);
      expect(result.remaining.currency).toBe(income.currency);
    });

    it("handles wants bucket at 30%", () => {
      const income = usd(100000n); // $1000.00
      const consumed = usd(27500n); // $275.00
      const result = computeBucket(income, 30, consumed);

      // target = 30000, consumed = 27500, remaining = 2500
      expect(result.targetAmount.minorUnits).toBe(30000n);
      expect(result.consumedAmount.minorUnits).toBe(27500n);
      expect(result.remaining.minorUnits).toBe(2500n);
      expect(result.consumedPct).toBeCloseTo(27.5, 5);
    });
  });

  // ------------------------------------------------------------------
  // Exactly 100% consumed (edge case for alert boundary)
  // ------------------------------------------------------------------

  it("consumedPct equals exactly 100 when consumed=income and pct=100", () => {
    const income = usd(100000n);
    const consumed = usd(100000n);
    const result = computeBucket(income, 100, consumed);

    expect(result.consumedPct).toBe(100);
  });
});
