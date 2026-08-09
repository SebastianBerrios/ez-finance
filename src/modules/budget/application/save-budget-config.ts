import { validateConfig } from "@/modules/budget/domain/budget-config";
import type { BudgetConfigError } from "@/modules/budget/domain/budget-config-error";
import type { IncomeMode } from "@shared/domain/budget-types";
import { zero } from "@shared/domain/money";
import { err, ok, type Result } from "@shared/domain/result";

import type {
  BudgetConfigPort,
  BudgetConfigDraft,
} from "./ports/budget-config-port";

/** IncomeMode as runtime values — the type cannot be iterated. */
const INCOME_MODES: readonly IncomeMode[] = ["mayor", "real", "esperado"];

interface SaveBudgetConfigInput {
  readonly workspaceId: string;
  /** Any date inside the month the config starts applying to. */
  readonly month: Date;
  readonly incomeMode: string;
  readonly expectedIncomeMinorUnits: bigint;
  readonly percentages: {
    readonly need: number;
    readonly want: number;
    readonly save: number;
  };
  readonly nearLimitThresholdPct?: number;
}

interface SaveBudgetConfigDeps {
  readonly budget: BudgetConfigPort;
}

/**
 * Store the budget config that takes effect from a given month.
 *
 * The percentage rules are NOT re-implemented here: validateConfig is the engine's
 * own guard, in this same module, and it is the authority on what the engine will
 * accept. Writing a second version would let the two drift, and the one that
 * matters is the one the dashboard runs.
 *
 * 50/30/20 is a default supplied by the caller, not a rule enforced here — any
 * split validateConfig accepts is stored.
 */
export async function saveBudgetConfig(
  input: SaveBudgetConfigInput,
  deps: SaveBudgetConfigDeps,
): Promise<Result<void, BudgetConfigError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  if (input.expectedIncomeMinorUnits < 0n) {
    return err({ kind: "InvalidConfig" });
  }

  const incomeMode = INCOME_MODES.find((mode) => mode === input.incomeMode);
  if (incomeMode === undefined) {
    return err({ kind: "InvalidConfig" });
  }

  // validateConfig needs a Money for expectedIncome, but only inspects the
  // percentages — the currency check lives in the engine, which has the snapshot.
  // A zero Money in the engine's own supported set satisfies the shape without
  // asserting anything about the workspace's currency, which is not known here.
  const placeholderIncome = zero("PEN");
  if (!placeholderIncome.ok) {
    return err({ kind: "Unavailable" });
  }

  const valid = validateConfig({
    incomeMode,
    expectedIncome: placeholderIncome.value,
    percentages: input.percentages,
  });
  if (!valid.ok) {
    return err({ kind: "InvalidConfig" });
  }

  // Built conditionally rather than with `nearLimitThresholdPct: input.x`:
  // exactOptionalPropertyTypes is on, and the engine defaults the threshold to 80
  // when the KEY IS ABSENT. A present-but-undefined value is a different thing.
  const stored: BudgetConfigDraft =
    input.nearLimitThresholdPct === undefined
      ? {
          incomeMode,
          expectedIncomeMinorUnits: input.expectedIncomeMinorUnits,
          percentages: input.percentages,
        }
      : {
          incomeMode,
          expectedIncomeMinorUnits: input.expectedIncomeMinorUnits,
          percentages: input.percentages,
          nearLimitThresholdPct: input.nearLimitThresholdPct,
        };

  const saved = await deps.budget.saveFromMonth(
    input.workspaceId,
    input.month,
    stored,
  );
  if (!saved.ok) return err(saved.error);

  return ok(undefined);
}
