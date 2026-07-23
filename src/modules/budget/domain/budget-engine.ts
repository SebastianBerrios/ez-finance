// budget-engine.ts — pure domain: computeBudget orchestrator
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type { BudgetConfig, BudgetResult, ConfigError, MonthlySnapshot } from "@shared/domain/budget-types";
import type { Money } from "@shared/domain/money";
import { add, subtract } from "@shared/domain/money";
import { Result, err, expectOk, ok } from "@shared/domain/result";
import { generateAlerts } from "./alerts";
import { computeBucket } from "./bucket";
import { validateConfig } from "./budget-config";
import { resolveIncome } from "./income-resolver";
import { computeSavings } from "./savings";
import { classify } from "./transfer-classifier";

/**
 * Compute the monthly budget result.
 *
 * Pure function — no IO, no side effects, no mutable state.
 *
 * Pipeline (per design §3):
 *  1. validateConfig(config)              → propagate err on invalid config
 *  2. Currency check: expectedIncome.currency === baseCurrency
 *  3. classify(snapshot)                  → per-bucket/category expense totals
 *  4. resolveIncome(snapshot, config)     → effective income (mode: mayor/real/esperado)
 *  5. computeSavings(classified)          → total savings (expenses + transfer inflow)
 *  6. computeBucket × 3                  → per-bucket results (save uses savingsAmount)
 *  7. globalAvailable = income - totalConsumed
 *  8. generateAlerts(...)                 → pure alert data
 *  9. assemble BudgetResult
 */
export function computeBudget(
  snapshot: MonthlySnapshot,
  config: BudgetConfig,
): Result<BudgetResult, ConfigError> {
  // Step 1: validate config
  const configResult = validateConfig(config);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  // Step 2: currency check (expectedIncome must be in baseCurrency)
  if (config.expectedIncome.currency !== snapshot.baseCurrency) {
    return err<ConfigError>({
      kind: "ConfigError",
      reason: "income-currency-mismatch",
      detail: `expectedIncome currency '${config.expectedIncome.currency}' does not match snapshot baseCurrency '${snapshot.baseCurrency}'`,
    });
  }

  // Step 3: classify transactions
  const classified = classify(snapshot);

  // Step 4: resolve effective income
  const income = resolveIncome(snapshot, config);

  // Step 5: compute total savings amount (save-bucket expenses + transfer inflow)
  const savingsAmount = computeSavings(classified, snapshot.baseCurrency);

  // Step 6: compute per-bucket results
  // Note: the save bucket's consumed = savingsAmount (INCLUDES transfer inflow, per REQ-E-14)
  const needBucket = computeBucket(income, config.percentages.need, classified.expenseByBucket.need);
  const wantBucket = computeBucket(income, config.percentages.want, classified.expenseByBucket.want);
  const saveBucket = computeBucket(income, config.percentages.save, savingsAmount);

  const buckets = { need: needBucket, want: wantBucket, save: saveBucket };

  // Step 7: globalAvailable = income - (need.consumed + want.consumed + save.consumed)
  const totalConsumed = computeTotalConsumed(
    needBucket.consumedAmount,
    wantBucket.consumedAmount,
    saveBucket.consumedAmount,
  );
  const globalAvailable = expectOk(subtract(income, totalConsumed));

  // Build categoryBucket map for alert generation
  const categoryBucket = new Map<string, import("@shared/domain/budget-types").Bucket | null>();
  for (const cat of snapshot.categories) {
    categoryBucket.set(cat.id, cat.bucket);
  }

  // Step 8: generate alerts
  const alerts = generateAlerts({ buckets }, classified, config, categoryBucket);

  // Step 9: assemble and return
  return ok({
    incomeUsed: income,
    buckets,
    globalAvailable,
    savingsAmount,
    alerts,
  });
}

/**
 * Sum three money values of the same currency.
 * All three are same-currency by invariant (orchestrator currency guard passed).
 */
function computeTotalConsumed(need: Money, want: Money, save: Money): Money {
  const needWant = expectOk(add(need, want));
  return expectOk(add(needWant, save));
}
