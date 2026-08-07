// supabase-goal-adapter.ts — implements GoalPort.
// The only file in the goals module that talks to @supabase/*.
import type {
  GoalError,
  GoalPort,
  GoalProgress,
  GoalRef,
} from "@/modules/goals/application/ports/goal-port";
import type { GoalDraft } from "@/modules/goals/domain/goal-draft";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Map a backend failure.
 *
 * THE MESSAGE IS INSPECTED FOR ONE SENTINEL AND DISCARDED. The cross-workspace guard is
 * a trigger raising `account_not_in_workspace` with 23514 — the same SQLSTATE the
 * column CHECKs use — so the code alone cannot tell "you picked another workspace's
 * account" from "the target was negative". Since only the first is reachable past the
 * domain's own validation, matching the sentinel is what turns it into a sentence
 * instead of "no pudimos guardar".
 */
function mapPostgresError(error: PostgresErrorLike): GoalError {
  if ((error.message ?? "").includes("account_not_in_workspace")) {
    return { kind: "AccountNotInWorkspace" };
  }

  switch (error.code) {
    case "42501":
      return { kind: "NotPermitted" };
    case "23503":
      return { kind: "WorkspaceNotFound" };
    case "23514":
      // A CHECK the domain should have caught first; reported honestly rather than
      // guessed at.
      return { kind: "Unavailable" };
    default:
      return { kind: "Unavailable" };
  }
}

interface ProgressRow {
  readonly id: string;
  readonly name: string;
  readonly account_id: string;
  readonly account_name: string;
  readonly target_amount: number | string;
  readonly saved_amount: number | string;
  readonly target_date: string | null;
  readonly achieved_at: string | null;
}

/** bigint columns arrive as a number or a string depending on magnitude and driver. */
function toBigInt(value: number | string): bigint {
  return BigInt(typeof value === "string" ? value : Math.trunc(value));
}

export class SupabaseGoalAdapter implements GoalPort {
  async listWithProgress(
    workspaceId: string,
  ): Promise<Result<readonly GoalProgress[], GoalError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase.rpc("goal_progress", {
        p_workspace_id: workspaceId,
      });

      if (error) return err(mapPostgresError(error));

      return ok(
        ((data ?? []) as ProgressRow[]).map((row): GoalProgress => ({
          id: row.id,
          name: row.name,
          accountId: row.account_id,
          accountName: row.account_name,
          targetMinorUnits: toBigInt(row.target_amount),
          savedMinorUnits: toBigInt(row.saved_amount),
          targetDate: row.target_date,
          achieved: row.achieved_at !== null,
        })),
      );
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async create(
    workspaceId: string,
    draft: GoalDraft,
  ): Promise<Result<GoalRef, GoalError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase
        .from("goals")
        .insert({
          workspace_id: workspaceId,
          account_id: draft.accountId,
          name: draft.name,
          target_amount: draft.targetAmountMinorUnits.toString(),
          // Omitted rather than null when there is no deadline, so the column keeps its
          // own default and the two states stay distinguishable.
          ...(draft.targetDate === undefined
            ? {}
            : { target_date: draft.targetDate }),
        })
        .select("id")
        .single();

      if (error) return err(mapPostgresError(error));
      if (data === null) return err({ kind: "Unavailable" });

      return ok({ id: (data as { id: string }).id });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async archive(
    workspaceId: string,
    goalId: string,
  ): Promise<Result<void, GoalError>> {
    try {
      const supabase = await createServerClient();

      const { error, count } = await supabase
        .from("goals")
        .update({ archived_at: new Date().toISOString() }, { count: "exact" })
        .eq("workspace_id", workspaceId)
        .eq("id", goalId);

      if (error) return err(mapPostgresError(error));

      // Zero rows is a refusal, not a no-op: RLS filters a forbidden UPDATE out rather
      // than raising. Same rule as accounts and categories.
      if (count === 0) return err({ kind: "NotPermitted" });

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
