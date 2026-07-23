// bucket.ts — pure domain: compute per-bucket result
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type { BucketResult } from "@shared/domain/budget-types";
import type { Money } from "@shared/domain/money";
import { isZero, makeRate, multiplyByRate, subtract } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

/**
 * Compute the BucketResult for one budget bucket.
 *
 * @param income - The effective income for the month (already resolved)
 * @param pct - The bucket's percentage of income (e.g. 50 for 50%)
 * @param consumed - The total amount consumed by this bucket
 *
 * Zero-income guard (REQ-E-08):
 *   If income is zero, targetAmount = 0 and consumedPct = 0 (NEVER NaN, never divide-by-zero).
 *
 * consumedPct is computed against INCOME (not target):
 *   consumedPct = (consumed.minorUnits / income.minorUnits) * 100
 *   This means a single bucket can show > 100% if spending exceeds income.
 */
export function computeBucket(income: Money, pct: number, consumed: Money): BucketResult {
  // Compute target = income * (pct / 100) via half-even multiplyByRate
  const rate = expectOk(makeRate(BigInt(Math.round(pct)), 100n));
  const targetAmount = multiplyByRate(income, rate);

  // Zero-income guard: if income is zero, consumedPct must be 0 (not NaN from 0/0)
  const consumedPct = isZero(income)
    ? 0
    : (Number(consumed.minorUnits) * 100) / Number(income.minorUnits);

  // remaining = target - consumed (may be negative when over budget)
  const remaining = expectOk(subtract(targetAmount, consumed));

  return {
    targetAmount,
    consumedAmount: consumed,
    consumedPct,
    remaining,
  };
}
