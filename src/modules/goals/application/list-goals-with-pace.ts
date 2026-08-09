import type { GoalError } from "@/modules/goals/domain/goal-error";
import { type GoalPace, goalPace } from "@/modules/goals/domain/goal-pace";
import { type Result, err, ok } from "@shared/domain/result";

import type { GoalPort, GoalProgress } from "./ports/goal-port";

export type { GoalPace };

export interface GoalWithPace {
  readonly goal: GoalProgress;
  /**
   * null when the pace cannot be judged: a stored target_date that is not a real
   * date, or a window that ends before it starts. Drift, in other words — and a goal
   * whose pace is unknown still has to appear in the list with its progress bar.
   */
  readonly pace: GoalPace | null;
}

interface ListGoalsWithPaceInput {
  readonly workspaceId: string;
  /** Resolved by the caller so the server and the screen cannot disagree about today. */
  readonly today: Date;
}

interface ListGoalsWithPaceDeps {
  readonly goals: GoalPort;
}

/**
 * Every goal, with whether it is keeping up.
 *
 * WHY THIS EXISTS RATHER THAN THE PAGE DOING IT. eslint-plugin-boundaries forbids the
 * app layer importing a module's domain, so a page cannot call goalPace() — and that
 * boundary is right twice over here. Computing it on the SERVER also keeps `today` out
 * of the browser: a client component deriving the pace from `new Date()` would produce
 * a different answer from the server render at midnight, which is a hydration mismatch
 * on a screen about deadlines.
 *
 * A goal whose pace cannot be computed is NOT dropped. The list is the only place
 * someone can see or archive it, so hiding it over an unparseable date would hide the
 * row that fixes the problem.
 */
export async function listGoalsWithPace(
  input: ListGoalsWithPaceInput,
  deps: ListGoalsWithPaceDeps,
): Promise<Result<readonly GoalWithPace[], GoalError>> {
  const goals = await deps.goals.listWithProgress(input.workspaceId);

  if (!goals.ok) return err(goals.error);

  return ok(
    goals.value.map((goal) => {
      const pace = goalPace({
        targetMinorUnits: goal.targetMinorUnits,
        savedMinorUnits: goal.savedMinorUnits,
        targetDate: goal.targetDate,
        startedAt: new Date(goal.startedAt),
        today: input.today,
      });

      return { goal, pace: pace.ok ? pace.value : null };
    }),
  );
}

/** The goals a person should be told about — at risk, or past their date unfunded. */
export function goalsNeedingAttention(
  goals: readonly GoalWithPace[],
): readonly GoalWithPace[] {
  return goals.filter(
    (entry) =>
      entry.pace !== null &&
      (entry.pace.kind === "AT_RISK" || entry.pace.kind === "OVERDUE"),
  );
}
