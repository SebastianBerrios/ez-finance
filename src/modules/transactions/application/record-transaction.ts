import { transactionDraft } from "@/modules/transactions/domain/transaction-draft";
import type { TransactionError } from "@/modules/transactions/domain/transaction-error";
import { err, type Result } from "@shared/domain/result";

import type { TransactionPort, TransactionRef } from "./ports/transaction-port";

interface RecordTransactionInput {
  readonly workspaceId: string;
  readonly authorId: string;
  readonly kind: string;
  readonly baseAmountMinorUnits: bigint;
  readonly occurredOn: string;
  readonly accountId: string;
  readonly categoryId?: string;
  readonly note?: string;
}

interface RecordTransactionDeps {
  readonly transactions: TransactionPort;
}

/**
 * Record one income or expense.
 *
 * Validation happens before the round trip, and the transfer case is refused here
 * rather than at the database: a transfer needs two tied rows and the INSERT policy
 * rejects a lone leg, so letting one through would turn a form error into an
 * unreadable policy violation.
 */
export async function recordTransaction(
  input: RecordTransactionInput,
  deps: RecordTransactionDeps,
): Promise<Result<TransactionRef, TransactionError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotReady" });
  }

  // RLS requires created_by = auth.uid(); without an author the write cannot
  // succeed, and failing now says something the person can act on.
  if (input.authorId.trim().length === 0) {
    return err({ kind: "NotPermitted" });
  }

  const draft = transactionDraft.create({
    kind: input.kind,
    baseAmountMinorUnits: input.baseAmountMinorUnits,
    occurredOn: input.occurredOn,
    accountId: input.accountId,
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    ...(input.note === undefined ? {} : { note: input.note }),
  });

  if (!draft.ok) return err(draft.error);

  return deps.transactions.record(
    input.workspaceId,
    draft.value,
    input.authorId,
  );
}
