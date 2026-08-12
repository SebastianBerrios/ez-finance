// supabase-split-adapter.ts — implements SplitPort.
// The only file in the splits module that talks to @supabase/*.
import type {
  OwedSplit,
  SplitPort,
  SplitRef,
} from "@/modules/splits/application/ports/split-port";
import type { SplitDraft } from "@/modules/splits/domain/split-draft";
import type { SplitError } from "@/modules/splits/domain/split-error";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Translate a failure into a domain kind.
 *
 * THE MESSAGE IS READ HERE AND NOWHERE ELSE. The RPCs signal every refusal by RAISE and
 * PostgREST returns them as a message string, so this is the one place that looks at
 * backend text. It is matched against the exact sentinels the functions raise and then
 * discarded: SplitError carries kinds only.
 */
function mapPostgresError(error: PostgresErrorLike): SplitError {
  const message = error.message ?? "";

  if (message.includes("already_settled")) return { kind: "AlreadySettled" };
  if (message.includes("workspace_not_ready")) {
    return { kind: "WorkspaceNotReady" };
  }
  if (
    message.includes("nothing_owed") ||
    message.includes("debtors_required")
  ) {
    return { kind: "DebtorsRequired" };
  }
  if (message.includes("debtor_name_required")) {
    return { kind: "DebtorNameRequired" };
  }
  if (message.includes("invalid_debtor_amount")) {
    return { kind: "InvalidDebtorAmount" };
  }
  if (message.includes("invalid_share")) return { kind: "InvalidShare" };
  // The triggers: an account or category from another workspace, or a split pointed at
  // something that is not an expense.
  if (
    message.includes("not_in_workspace") ||
    message.includes("split_requires_expense") ||
    error.code === "23503"
  ) {
    return { kind: "UnknownReference" };
  }
  if (
    message.includes("not_permitted") ||
    message.includes("not allowed") ||
    message.includes("session_not_found") ||
    error.code === "42501"
  ) {
    return { kind: "NotPermitted" };
  }

  return { kind: "Unavailable" };
}

interface OwedRow {
  readonly id: string;
  readonly debtor_name: string;
  readonly amount: string | number;
  readonly settled_at: string | null;
  readonly created_at: string;
  readonly transactions: {
    readonly note: string | null;
    readonly occurred_on: string;
    readonly categories: { name: string } | { name: string }[] | null;
  } | null;
}

function embeddedName(
  value: { name: string } | { name: string }[] | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : value.name;
}

export class SupabaseSplitAdapter implements SplitPort {
  async recordSplitExpense(
    workspaceId: string,
    draft: SplitDraft,
  ): Promise<Result<SplitRef | null, SplitError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase.rpc("record_split_expense", {
        p_workspace_id: workspaceId,
        p_account_id: draft.accountId,
        p_category_id: draft.categoryId ?? null,
        // A STRING: the column is bigint and a JS number cannot carry it past 2^53.
        p_my_share: draft.myShareMinorUnits.toString(),
        p_occurred_on: draft.occurredOn,
        p_note: draft.note ?? null,
        // Amounts as strings for the same reason, inside the jsonb payload.
        p_debtors: draft.debtors.map((debtor) => ({
          name: debtor.name,
          amount: debtor.amountMinorUnits.toString(),
        })),
      });

      if (error) return err(mapPostgresError(error));

      // The RPC returns the expense's id, or NULL when the share was zero and no
      // expense row was written. Null is a success, not a failure.
      if (typeof data !== "string" || data.length === 0) return ok(null);

      return ok({ id: data });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async listOwed(
    workspaceId: string,
  ): Promise<Result<readonly OwedSplit[], SplitError>> {
    try {
      const supabase = await createServerClient();

      // The expense's note, date and category come through embedded selects rather
      // than a second round trip: PostgREST resolves them over the foreign keys and
      // RLS still applies to the embedded tables.
      const { data, error } = await supabase
        .from("expense_splits")
        .select(
          "id, debtor_name, amount, settled_at, created_at, transactions(note, occurred_on, categories(name))",
        )
        .eq("workspace_id", workspaceId)
        // Unsettled first, then newest: the list exists to answer "who still owes me",
        // and the settled rows are history below it.
        .order("settled_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false });

      if (error) return err(mapPostgresError(error));

      return ok(
        ((data ?? []) as unknown as OwedRow[]).map((row) => ({
          id: row.id,
          debtorName: row.debtor_name,
          amountMinorUnits: BigInt(row.amount),
          expenseNote: row.transactions?.note ?? null,
          categoryName: embeddedName(row.transactions?.categories),
          // Every split points at a row that has a date — the expense, or the leg that
          // landed on "Por cobrar" when your share was zero. The fallback covers the
          // one case left: an embedded read RLS filtered out, where showing the split's
          // own creation day beats showing nothing.
          occurredOn:
            row.transactions?.occurred_on ?? row.created_at.slice(0, 10),
          settled: row.settled_at !== null,
        })),
      );
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async settle(
    workspaceId: string,
    splitId: string,
    toAccountId: string,
    occurredOn: string,
  ): Promise<Result<void, SplitError>> {
    try {
      const supabase = await createServerClient();

      // workspaceId is not passed: the RPC derives the workspace from the split row
      // itself and checks membership against that. Taking it from the caller would be
      // taking a claim the server would then have to distrust.
      void workspaceId;

      const { error } = await supabase.rpc("settle_split", {
        p_split_id: splitId,
        p_to_account_id: toAccountId,
        p_occurred_on: occurredOn,
      });

      if (error) return err(mapPostgresError(error));

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
