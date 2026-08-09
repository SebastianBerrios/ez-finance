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
/** One per-category ceiling, in minor units of the workspace's base currency. */
export interface StoredCategoryLimit {
  readonly categoryId: string;
  readonly limitMinorUnits: bigint;
}

/**
 * What a WRITE carries: the budget itself, and nothing that only exists once stored.
 *
 * Split from StoredBudgetConfig when limits arrived, because the two directions stopped
 * having the same obligations — the type system said so immediately. Saving cannot
 * supply the row's id (the upsert decides it) and does not touch limits, so a single
 * shared type would have forced every caller of saveFromMonth to invent both.
 */
export interface BudgetConfigDraft {
  readonly incomeMode: IncomeMode;
  readonly expectedIncomeMinorUnits: bigint;
  readonly percentages: {
    readonly need: number;
    readonly want: number;
    readonly save: number;
  };
  readonly nearLimitThresholdPct?: number;
}

/** What a READ answers: the draft, plus what only exists once it is stored. */
export interface StoredBudgetConfig extends BudgetConfigDraft {
  /**
   * The config row's id.
   *
   * Carried because a limit is written AGAINST the config that was just read, and
   * resolving "which config is in force for month M" a second time in the adapter
   * would be that rule in two places — the exact thing budget_config_for exists to
   * prevent.
   */
  readonly id: string;
  /** Empty when none are set; never undefined, so callers have one shape to read. */
  readonly categoryLimits: readonly StoredCategoryLimit[];
}

export interface BudgetConfigPort {
  /**
   * Set or clear one category's ceiling on a given config.
   *
   * `limitMinorUnits === null` REMOVES it. A limit of zero is not a limit — the check
   * on the column refuses it — and modelling "no ceiling" as zero would make the
   * engine treat every peso spent as over budget.
   *
   * Upsert, keyed by (config, category): the screen offers one field per category and
   * a person editing the same one twice means the second value, not a second row.
   */
  setCategoryLimit(
    workspaceId: string,
    budgetConfigId: string,
    categoryId: string,
    limitMinorUnits: bigint | null,
  ): Promise<Result<void, BudgetConfigError>>;
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
    config: BudgetConfigDraft,
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
