// income-resolver.ts — pure domain: resolve effective income from snapshot + config
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type {
  BudgetConfig,
  MonthlySnapshot,
} from "@shared/domain/budget-types";
import type { Money } from "@shared/domain/money";
import { zero, add, compare } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

/**
 * Resolve the effective income for budget computation.
 *
 * Modes:
 *  - 'real'     → sum of all income-kind transactions in the snapshot
 *  - 'esperado' → config.expectedIncome (always, regardless of real)
 *  - 'mayor'    → max(realIncome, config.expectedIncome)
 *
 * All amounts assumed same currency (orchestrator validates before calling).
 * Returns Money — never a Result (inputs pre-validated by orchestrator).
 */
export function resolveIncome(
  snapshot: MonthlySnapshot,
  config: BudgetConfig,
): Money {
  // Compute realIncome = sum of income-kind transactions
  const seed = expectOk(zero(snapshot.baseCurrency));
  const realIncome = snapshot.transactions
    .filter((tx) => tx.kind === "income")
    .reduce<Money>((acc, tx) => expectOk(add(acc, tx.amount)), seed);

  switch (config.incomeMode) {
    case "real":
      return realIncome;

    case "esperado":
      return config.expectedIncome;

    case "mayor": {
      // max(realIncome, expectedIncome) — compare returns -1 | 0 | 1
      const cmp = expectOk(compare(realIncome, config.expectedIncome));
      return cmp >= 0 ? realIncome : config.expectedIncome;
    }
  }
}
