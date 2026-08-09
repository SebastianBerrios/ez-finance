import type { BudgetConfigError } from "@/modules/budget/domain/budget-config-error";
import { err, ok, type Result } from "@shared/domain/result";

import type { BudgetConfigPort } from "./ports/budget-config-port";

interface SetCategoryLimitInput {
  readonly workspaceId: string;
  /** The month whose config the limit belongs to. */
  readonly month: Date;
  readonly categoryId: string;
  /** null REMOVES the limit. Zero is refused — see below. */
  readonly limitMinorUnits: bigint | null;
}

interface SetCategoryLimitDeps {
  readonly budget: BudgetConfigPort;
}

/**
 * Set or clear one category's ceiling for a month.
 *
 * IT RESOLVES THE CONFIG FIRST, and that is the whole reason this is a use case rather
 * than a straight adapter call. A limit belongs to the budget config in force for the
 * month (spec §5.6 makes limits part of the budget, and budget configs are versioned by
 * effective_from) — so writing one requires knowing WHICH config, and that question has
 * exactly one correct answer, produced by budget_config_for.
 *
 * A workspace with no config yet is NotConfigured: there is nothing to hang a limit on,
 * and the honest response is the wizard rather than inventing a config as a side effect
 * of typing a number into a field.
 *
 * ZERO IS NOT A LIMIT. The column refuses it and so does this: a ceiling of zero is a
 * prohibition, and the engine would read every peso spent against that category as over
 * budget. Someone who means "never spend here" archives the category. Clearing is
 * expressed as null, which is a different intent and a different statement.
 */
export async function setCategoryLimit(
  input: SetCategoryLimitInput,
  deps: SetCategoryLimitDeps,
): Promise<Result<void, BudgetConfigError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  if (input.categoryId.trim().length === 0) {
    return err({ kind: "InvalidConfig" });
  }

  if (input.limitMinorUnits !== null && input.limitMinorUnits <= 0n) {
    return err({ kind: "InvalidConfig" });
  }

  const config = await deps.budget.findForMonth(input.workspaceId, input.month);

  if (!config.ok) return err(config.error);
  if (config.value === null) return err({ kind: "NotConfigured" });

  return deps.budget.setCategoryLimit(
    input.workspaceId,
    config.value.id,
    input.categoryId,
    input.limitMinorUnits,
  );
}
