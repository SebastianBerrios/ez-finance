import { goalDraft } from "@/modules/goals/domain/goal-draft";
import type { GoalError } from "@/modules/goals/domain/goal-error";
import { err, type Result } from "@shared/domain/result";

import type { GoalPort, GoalRef } from "./ports/goal-port";

interface CreateGoalInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly accountId: string;
  readonly targetAmountMinorUnits: bigint;
  readonly targetDate?: string;
}

interface CreateGoalDeps {
  readonly goals: GoalPort;
}

/**
 * Create a savings goal.
 *
 * Validates before the round trip, like createAccount and createCategory. The one rule
 * it CANNOT check here is that the account belongs to the workspace: that needs the
 * database, so the adapter maps the trigger's `account_not_in_workspace` back into a
 * kind rather than this pretending to know.
 */
export async function createGoal(
  input: CreateGoalInput,
  deps: CreateGoalDeps,
): Promise<Result<GoalRef, GoalError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  const draft = goalDraft({
    name: input.name,
    accountId: input.accountId,
    targetAmountMinorUnits: input.targetAmountMinorUnits,
    ...(input.targetDate === undefined ? {} : { targetDate: input.targetDate }),
  });

  if (!draft.ok) return err(draft.error);

  return deps.goals.create(input.workspaceId, draft.value);
}
