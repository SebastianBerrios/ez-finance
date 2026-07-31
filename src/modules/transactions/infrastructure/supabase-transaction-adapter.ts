// supabase-transaction-adapter.ts — implements TransactionPort.
// Only file in the transactions module that talks to @supabase/*.
import type {
  TransactionPort,
  TransactionRef,
} from "@/modules/transactions/application/ports/transaction-port";
import type { TransactionDraft } from "@/modules/transactions/domain/transaction-draft";
import type { TransactionError } from "@/modules/transactions/domain/transaction-error";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Translate a write failure into a domain kind.
 *
 * `P0001` is our own triggers raising: transactions_validate_refs rejects an
 * account or category from another workspace, and it also refuses a write before
 * the workspace has a base currency. Both are told apart by the message, which is
 * the ONLY place a backend string is read — and it never leaves this function.
 */
function mapPostgresError(error: PostgresErrorLike): TransactionError {
  if (error.code === "42501") return { kind: "NotPermitted" };
  if (error.code === "23503") return { kind: "UnknownReference" };

  if (error.code === "P0001") {
    return (error.message ?? "").includes("base currency")
      ? { kind: "WorkspaceNotReady" }
      : { kind: "UnknownReference" };
  }

  return { kind: "Unavailable" };
}

export class SupabaseTransactionAdapter implements TransactionPort {
  async record(
    workspaceId: string,
    draft: TransactionDraft,
    authorId: string,
  ): Promise<Result<TransactionRef, TransactionError>> {
    try {
      const supabase = await createServerClient();

      // Amounts as STRINGS: both columns are bigint and a JS number loses
      // precision past 2^53.
      const amount = draft.baseAmountMinorUnits.toString();

      const { data, error } = await supabase
        .from("transactions")
        .insert({
          workspace_id: workspaceId,
          account_id: draft.accountId,
          kind: draft.kind,
          base_amount: amount,
          // Single-currency app: what was entered IS the base, and the frozen rate
          // is 1. The columns for a differing currency are enforced by the schema
          // but nothing writes them yet, so they are filled from the base rather
          // than from a conversion that did not happen.
          entered_amount: amount,
          entered_currency: "PEN",
          exchange_rate: 1,
          occurred_on: draft.occurredOn,
          category_id: draft.categoryId ?? null,
          note: draft.note ?? null,
          // RLS demands this equals auth.uid().
          created_by: authorId,
        })
        .select("id")
        .single();

      if (error) return err(mapPostgresError(error));
      if (!data) return err({ kind: "Unavailable" });

      return ok({ id: data.id as string });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
