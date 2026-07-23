// savings.ts — pure domain: compute total savings consumption for the month
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type { Money, CurrencyCode } from "@shared/domain/money";
import { add } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import type { Classified } from "./transfer-classifier";

/**
 * Compute the total savings consumed this month.
 *
 * savingsAmount = expenseByBucket.save + transferSavingsInflow
 *
 * These two sources are ADDITIVE per REQ-E-14 / §5.6 rule 9:
 *  - save-bucket expenses (regular expense txs with a save-bucket category)
 *  - outgoing-leg amounts of operational→savings transfers
 *
 * Both are already in baseCurrency (same currency guaranteed by orchestrator).
 * Returns Money (never Result — inputs pre-validated).
 */
export function computeSavings(classified: Classified, _baseCurrency: CurrencyCode): Money {
  return expectOk(add(classified.expenseByBucket.save, classified.transferSavingsInflow));
}
