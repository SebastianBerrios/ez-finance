import type { GoalDraft } from "@/modules/goals/domain/goal-draft";
import type { GoalError } from "@/modules/goals/domain/goal-error";
import type { Result } from "@shared/domain/result";

export type { GoalError };

export interface GoalRef {
  readonly id: string;
}

/**
 * A goal with its progress, as `goal_progress()` returns it.
 *
 * `savedMinorUnits` is DERIVED — the balance of the account behind the goal — and can
 * exceed the target or go negative. Neither is clamped: reaching a goal and saving more
 * is not an error, and a goal backed by an overdrawn account is information.
 */
export interface GoalProgress {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly targetMinorUnits: bigint;
  readonly savedMinorUnits: bigint;
  readonly targetDate: string | null;
  readonly achieved: boolean;
  /**
   * When the goal was created — the START of its window.
   *
   * Carried because "en riesgo" (spec §5.8) is a comparison against a baseline, and
   * with no contribution history the only honest baseline is the goal's own timeline:
   * by the time 60 % of the window has passed, roughly 60 % should be saved. See
   * goal-pace.ts, and 20260807230000 for why goal_progress() returns it.
   */
  readonly startedAt: string;
}

export interface GoalPort {
  listWithProgress(
    workspaceId: string,
  ): Promise<Result<readonly GoalProgress[], GoalError>>;

  create(
    workspaceId: string,
    draft: GoalDraft,
  ): Promise<Result<GoalRef, GoalError>>;

  /**
   * Archive, never delete — the same rule as accounts and categories. A goal that was
   * reached is a record of having reached it.
   */
  archive(
    workspaceId: string,
    goalId: string,
  ): Promise<Result<void, GoalError>>;
}
