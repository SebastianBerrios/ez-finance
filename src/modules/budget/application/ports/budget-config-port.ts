import type { BudgetConfigError } from "@/modules/budget/domain/budget-config-error";
import type { IncomeMode } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";

/**
 * A budget config as it is stored, i.e. WITHOUT a currency.
 *
 * `BudgetConfig` in shared/domain/budget-types carries `expectedIncome` as Money,
 * because the engine needs to reject a config whose currency disagrees with the
 * snapshot's. Storage does not: the amount is always in the workspace's base
 * currency, which the workspace already knows and which is immutable. Keeping the
 * currency out of here means one fewer place it could disagree with itself — the
 * dashboard assembles the engine's BudgetConfig when it reads the workspace.
 */
export interface StoredBudgetConfig {
  readonly incomeMode: IncomeMode;
  readonly expectedIncomeMinorUnits: bigint;
  readonly percentages: {
    readonly need: number;
    readonly want: number;
    readonly save: number;
  };
  readonly nearLimitThresholdPct?: number;
}

export interface BudgetConfigPort {
  /**
   * Store the config that takes effect from `month` onward.
   *
   * `month` is any date inside the target month; the adapter normalises it to the
   * month boundary the table requires. Saving twice for the same month UPDATES
   * that month's row rather than stacking another — the table's unique index
   * guarantees it — so this is an upsert, and re-running onboarding does not
   * create a second January.
   */
  saveFromMonth(
    workspaceId: string,
    month: Date,
    config: StoredBudgetConfig,
  ): Promise<Result<void, BudgetConfigError>>;

  /**
   * The config in force for `month`: the most recent one starting at or before it.
   * `null` when the workspace has never had one, which is how the app knows
   * onboarding is unfinished.
   */
  findForMonth(
    workspaceId: string,
    month: Date,
  ): Promise<Result<StoredBudgetConfig | null, BudgetConfigError>>;
}
