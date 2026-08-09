// supabase-budget-config-adapter.ts — implements BudgetConfigPort.
// The only file in the budget module that talks to @supabase/*.
import type {
  BudgetConfigDraft,
  BudgetConfigPort,
  StoredBudgetConfig,
} from "@/modules/budget/application/ports/budget-config-port";
import type { BudgetConfigError } from "@/modules/budget/domain/budget-config-error";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import type { IncomeMode } from "@shared/domain/budget-types";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
}

function mapPostgresError(error: PostgresErrorLike): BudgetConfigError {
  switch (error.code) {
    // An RLS refusal: only owner and admin manage the budget (spec §4).
    case "42501":
      return { kind: "NotPermitted" };
    case "23503":
      return { kind: "WorkspaceNotFound" };
    // A CHECK violation means the table rejected a config the use case validated,
    // i.e. the two disagree. Not reported as a field error, because guessing which
    // field from a constraint name is how a wrong message reaches a valid input.
    default:
      return { kind: "Unavailable" };
  }
}

/** First day of `date`'s month, as YYYY-MM-DD — the boundary the table requires. */
function monthStartIso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}-01`;
}

interface ConfigRow {
  readonly id: string;
  readonly income_mode: string;
  readonly expected_income: string | number;
  readonly pct_need: number;
  readonly pct_want: number;
  readonly pct_save: number;
  readonly near_limit_pct: number | null;
  /** Aggregated by budget_config_for; `[]` rather than null when there are none. */
  readonly category_limits:
    | readonly {
        readonly category_id: string;
        /** TEXT, not a number — a bigint through a JSON double loses precision. */
        readonly limit_amount: string;
      }[]
    | null;
}

export class SupabaseBudgetConfigAdapter implements BudgetConfigPort {
  async saveFromMonth(
    workspaceId: string,
    month: Date,
    config: BudgetConfigDraft,
  ): Promise<Result<void, BudgetConfigError>> {
    try {
      const supabase = await createServerClient();

      const { error } = await supabase.from("budget_configs").upsert(
        {
          workspace_id: workspaceId,
          effective_from: monthStartIso(month),
          income_mode: config.incomeMode,
          // A STRING: expected_income is bigint and a JS number loses precision
          // past 2^53. Money is bigint end to end and must not narrow here.
          expected_income: config.expectedIncomeMinorUnits.toString(),
          pct_need: config.percentages.need,
          pct_want: config.percentages.want,
          pct_save: config.percentages.save,
          near_limit_pct: config.nearLimitThresholdPct ?? null,
        },
        // Re-running a step must EDIT that month's config, not stack a second one
        // — the table's unique index makes a plain insert fail on the second pass.
        { onConflict: "workspace_id,effective_from" },
      );

      if (error) return err(mapPostgresError(error));

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async findForMonth(
    workspaceId: string,
    month: Date,
  ): Promise<Result<StoredBudgetConfig | null, BudgetConfigError>> {
    try {
      const supabase = await createServerClient();

      // Through the function, not a hand-rolled query: "the config in force for
      // month M" is the greatest effective_from at or before M, and that rule
      // lives in budget_config_for so every caller resolves the boundary the same
      // way.
      const { data, error } = await supabase.rpc("budget_config_for", {
        p_workspace_id: workspaceId,
        p_month: monthStartIso(month),
      });

      if (error) return err(mapPostgresError(error));

      const row = ((data ?? []) as ConfigRow[])[0];
      if (!row) return ok(null);

      // Amounts arrive as TEXT inside the jsonb (see 20260808010000): a bigint through
      // a JSON number loses precision past 2^53, which is the one thing this codebase
      // never lets happen to money.
      const categoryLimits = (row.category_limits ?? []).map((limit) => ({
        categoryId: limit.category_id,
        limitMinorUnits: BigInt(limit.limit_amount),
      }));

      const nearLimit = row.near_limit_pct;

      // Built conditionally: exactOptionalPropertyTypes is on and the engine
      // defaults the threshold to 80 when the KEY IS ABSENT, which is not the same
      // as present-and-undefined.
      const base = {
        id: row.id,
        categoryLimits,
        incomeMode: row.income_mode as IncomeMode,
        expectedIncomeMinorUnits: BigInt(row.expected_income),
        percentages: {
          need: row.pct_need,
          want: row.pct_want,
          save: row.pct_save,
        },
      };

      return ok(
        nearLimit === null
          ? base
          : { ...base, nearLimitThresholdPct: nearLimit },
      );
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async setCategoryLimit(
    workspaceId: string,
    budgetConfigId: string,
    categoryId: string,
    limitMinorUnits: bigint | null,
  ): Promise<Result<void, BudgetConfigError>> {
    try {
      const supabase = await createServerClient();

      // null CLEARS the ceiling. Modelled as a delete rather than a zero because the
      // column refuses zero: a limit of zero is a prohibition, not a budget, and the
      // engine would read every peso spent as over budget.
      if (limitMinorUnits === null) {
        const { error } = await supabase
          .from("category_limits")
          .delete()
          .eq("budget_config_id", budgetConfigId)
          .eq("category_id", categoryId);

        if (error) return err(mapPostgresError(error));
        return ok(undefined);
      }

      const { error } = await supabase.from("category_limits").upsert(
        {
          workspace_id: workspaceId,
          budget_config_id: budgetConfigId,
          category_id: categoryId,
          // A STRING: the column is bigint and a JS number cannot carry it past 2^53.
          limit_amount: limitMinorUnits.toString(),
        },
        // The table's primary key. Editing the same category twice means the second
        // value, not a second row.
        { onConflict: "budget_config_id,category_id" },
      );

      if (error) return err(mapPostgresError(error));

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
