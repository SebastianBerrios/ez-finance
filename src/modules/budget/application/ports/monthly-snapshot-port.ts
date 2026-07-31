import type { BudgetConfigError } from "@/modules/budget/domain/budget-config-error";
import type { MonthlySnapshot } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";

export interface MonthlySnapshotPort {
  /**
   * Everything the engine needs about one month: the workspace's base currency,
   * its accounts and categories, and the transactions dated inside that month.
   *
   * `null` when the workspace has no base currency yet — which means it has no
   * account, so it cannot have transactions either. That is an unfinished setup,
   * not an error.
   *
   * The snapshot is deliberately WHOLE rather than pre-aggregated. The engine
   * decides what a transfer to a savings account means and which categories count;
   * an adapter that summed things first would be re-implementing those rules in
   * SQL, where the tests cannot see them.
   */
  readForMonth(
    workspaceId: string,
    month: Date,
  ): Promise<Result<MonthlySnapshot | null, BudgetConfigError>>;
}
