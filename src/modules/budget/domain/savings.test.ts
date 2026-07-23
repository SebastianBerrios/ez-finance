// savings.test.ts — TDD-RED for computeSavings
// Tests: §5.6 rule 9 — savings = save-bucket expenses + outgoing-to-savings transfers (additive)

import { describe, expect, it } from "vitest";
import { fromMinorUnits, equals, zero } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { computeSavings } from "./savings";
import type { Classified } from "./transfer-classifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usd(n: bigint) {
  return expectOk(fromMinorUnits("USD", n));
}

function zeroUsd() {
  return expectOk(zero("USD"));
}

const USD_CURRENCY = usd(0n).currency;

function makeClassified(
  saveBucketExpense: bigint,
  transferSavingsInflow: bigint,
): Classified {
  return {
    incomeTotal: zeroUsd(),
    expenseByCategory: new Map(),
    expenseByBucket: {
      need: zeroUsd(),
      want: zeroUsd(),
      save: usd(saveBucketExpense),
    },
    transferSavingsInflow: usd(transferSavingsInflow),
  };
}

// ---------------------------------------------------------------------------
// computeSavings
// ---------------------------------------------------------------------------

describe("computeSavings", () => {
  it("returns zero when no save-bucket expenses and no transfers", () => {
    const classified = makeClassified(0n, 0n);
    const result = computeSavings(classified, USD_CURRENCY);
    expect(equals(result, zeroUsd())).toBe(true);
  });

  it("returns save-bucket expenses when no transfers to savings", () => {
    const classified = makeClassified(10000n, 0n); // $100 save-bucket expense
    const result = computeSavings(classified, USD_CURRENCY);
    expect(equals(result, usd(10000n))).toBe(true);
  });

  it("returns transfer inflow when no save-bucket expenses", () => {
    const classified = makeClassified(0n, 20000n); // $200 operational→savings transfer
    const result = computeSavings(classified, USD_CURRENCY);
    expect(equals(result, usd(20000n))).toBe(true);
  });

  it("§5.6 rule 9: additively sums save-bucket expenses AND transfer inflow", () => {
    // $100 save-bucket expense + $150 operational→savings transfer = $250
    const classified = makeClassified(10000n, 15000n);
    const result = computeSavings(classified, USD_CURRENCY);
    expect(equals(result, usd(25000n))).toBe(true);
  });

  it("scenario E-16: 100 save expense + 150 transfer = 250 total savings", () => {
    // From spec scenario E-16:
    // save-bucket expense = 100 USD (10000 cents), transfer inflow = 150 USD (15000 cents)
    const classified = makeClassified(10000n, 15000n);
    const result = computeSavings(classified, USD_CURRENCY);
    expect(equals(result, usd(25000n))).toBe(true);
  });

  it("handles large savings amounts correctly", () => {
    // $5000 save expense + $3000 transfer = $8000
    const classified = makeClassified(500000n, 300000n);
    const result = computeSavings(classified, USD_CURRENCY);
    expect(equals(result, usd(800000n))).toBe(true);
  });
});
