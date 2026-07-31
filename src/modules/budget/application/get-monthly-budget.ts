import type { BudgetConfigError } from "@/modules/budget/domain/budget-config-error";
import { computeBudget } from "@/modules/budget/domain/budget-engine";
import type { BudgetResult } from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { err, ok, type Result } from "@shared/domain/result";

import type { BudgetConfigPort } from "./ports/budget-config-port";
import type { MonthlySnapshotPort } from "./ports/monthly-snapshot-port";

interface GetMonthlyBudgetInput {
  readonly workspaceId: string;
  /** Any date inside the month to report on. */
  readonly month: Date;
}

interface GetMonthlyBudgetDeps {
  readonly snapshots: MonthlySnapshotPort;
  readonly budget: BudgetConfigPort;
}

/**
 * What the dashboard needs: the computed result AND the split it was computed
 * with.
 *
 * BudgetResult carries amounts and consumed percentages but NOT the configured
 * shares, and a view that wants to label a bucket "60 %" has nowhere else to read
 * that from. Returning it here beats letting the page hardcode 50/30/20 — which is
 * exactly the bug this shape prevents, since the person chooses their own split.
 */
export interface MonthlyBudgetView {
  readonly result: BudgetResult;
  readonly percentages: {
    readonly need: number;
    readonly want: number;
    readonly save: number;
  };
}

/**
 * The dashboard's one question: for this month, how much of each bucket is gone?
 *
 * All this does is assemble the engine's two inputs and hand them over. No
 * summing, no bucketing, no interpretation of transfers — those rules live in
 * computeBudget, which is pure and covered by its own suite, and a second opinion
 * here would be a second place for them to be wrong.
 *
 * The one piece of real work is currency. A stored config has no currency of its
 * own (see StoredBudgetConfig), while the engine REFUSES a config whose
 * expectedIncome disagrees with the snapshot's baseCurrency. Denominating the
 * income against the snapshot is therefore this function's job, and the only place
 * the two representations meet.
 */
export async function getMonthlyBudget(
  input: GetMonthlyBudgetInput,
  deps: GetMonthlyBudgetDeps,
): Promise<Result<MonthlyBudgetView, BudgetConfigError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  const snapshot = await deps.snapshots.readForMonth(
    input.workspaceId,
    input.month,
  );
  if (!snapshot.ok) return err(snapshot.error);

  const config = await deps.budget.findForMonth(input.workspaceId, input.month);
  if (!config.ok) return err(config.error);

  // Either absence means setup never finished. Reported as NotConfigured rather
  // than as a failure, because the caller's correct response is the wizard.
  if (snapshot.value === null || config.value === null) {
    return err({ kind: "NotConfigured" });
  }

  const expectedIncome = fromMinorUnits(
    snapshot.value.baseCurrency,
    config.value.expectedIncomeMinorUnits,
  );
  if (!expectedIncome.ok) {
    // The snapshot's currency came out of the database and Money did not accept
    // it — an unsupported code was stored, which no app path can produce.
    return err({ kind: "Unavailable" });
  }

  const near = config.value.nearLimitThresholdPct;

  const result = computeBudget(
    snapshot.value,
    // Built conditionally: exactOptionalPropertyTypes is on and the engine
    // defaults the threshold to 80 when the KEY IS ABSENT, which is not the same
    // as present-and-undefined.
    near === undefined
      ? {
          incomeMode: config.value.incomeMode,
          expectedIncome: expectedIncome.value,
          percentages: config.value.percentages,
        }
      : {
          incomeMode: config.value.incomeMode,
          expectedIncome: expectedIncome.value,
          percentages: config.value.percentages,
          nearLimitThresholdPct: near,
        },
  );

  if (!result.ok) {
    // A stored config the engine rejects means the write path and the engine have
    // drifted. Its own kind, so it is never mistaken for unfinished setup and the
    // person is not sent to a wizard that cannot fix it.
    return err({ kind: "InvalidConfig" });
  }

  return ok({ result: result.value, percentages: config.value.percentages });
}
