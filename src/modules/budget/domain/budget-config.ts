// budget-config.ts — pure domain: validate BudgetConfig
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type { BudgetConfig, ConfigError } from "@shared/domain/budget-types";
import { Result, ok, err } from "@shared/domain/result";

/**
 * Validate a BudgetConfig value.
 *
 * Guard order (per design §3):
 *  1. Any percentage < 0  → err('percentage-negative')
 *  2. Any percentage non-integer → err('percentage-not-integer')
 *  3. need + want + save !== 100 → err('percentages-not-100')
 *
 * Currency-vs-snapshot mismatch lives in the orchestrator (budget-engine.ts),
 * not here, because it requires the snapshot which is not an input here.
 *
 * Returns Result<void, ConfigError> — ok(undefined) on success.
 */
export function validateConfig(
  config: BudgetConfig,
): Result<void, ConfigError> {
  const { need, want, save } = config.percentages;

  // Guard 1: negative percentage (checked first, per spec)
  if (need < 0 || want < 0 || save < 0) {
    return err<ConfigError>({
      kind: "ConfigError",
      reason: "percentage-negative",
      detail: `Percentages must be >= 0; got need=${need}, want=${want}, save=${save}`,
    });
  }

  // Guard 2: percentages must be whole numbers (design contract: integers summing to 100).
  // Fractional values would be silently Math.round-ed downstream, distorting targets.
  if (
    !Number.isInteger(need) ||
    !Number.isInteger(want) ||
    !Number.isInteger(save)
  ) {
    return err<ConfigError>({
      kind: "ConfigError",
      reason: "percentage-not-integer",
      detail: `Percentages must be whole numbers; got need=${need}, want=${want}, save=${save}`,
    });
  }

  // Guard 3: sum must be exactly 100
  const sum = need + want + save;
  if (sum !== 100) {
    return err<ConfigError>({
      kind: "ConfigError",
      reason: "percentages-not-100",
      detail: `Percentages must sum to 100; got ${sum} (need=${need}, want=${want}, save=${save})`,
    });
  }

  return ok(undefined);
}
