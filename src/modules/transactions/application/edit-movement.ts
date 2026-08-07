import { transactionDraft } from "@/modules/transactions/domain/transaction-draft";
import type { TransactionError } from "@/modules/transactions/domain/transaction-error";
import { err, ok, type Result } from "@shared/domain/result";

import type { TransactionPort } from "./ports/transaction-port";

interface EditMovementInput {
  readonly workspaceId: string;
  readonly transactionId: string;
  /** Non-null when the row is one leg of a transfer, which is not editable. */
  readonly transferId: string | null;
  readonly kind: string;
  readonly baseAmountMinorUnits: bigint;
  readonly occurredOn: string;
  readonly accountId: string;
  readonly categoryId?: string;
  readonly note?: string;
}

interface EditMovementDeps {
  readonly transactions: TransactionPort;
}

/**
 * Correct a movement that was already recorded.
 *
 * The validation is `transactionDraft.create` — the SAME function recordTransaction
 * uses. An edited movement is not a laxer thing than a new one, and a second
 * validator would be a second set of rules to drift apart.
 *
 * TWO THINGS THIS EXISTS TO GET RIGHT, both mirrors of the delete path.
 *
 * A TRANSFER LEG IS NOT EDITABLE. The pair is tied (spec §5.5): raise the amount on
 * the 'out' leg and money leaves an account without arriving anywhere. There is no
 * "edit both legs" RPC, so this refuses rather than half-doing it — and the UPDATE
 * policy refuses it again at the database, which is what makes the refusal true and
 * not merely polite.
 *
 * And ZERO ROWS CHANGED IS A FAILURE. RLS declines an UPDATE by filtering the row
 * out: nothing changes, nothing raises. Only the count can tell the difference
 * between "saved" and "not yours".
 */
export async function editMovement(
  input: EditMovementInput,
  deps: EditMovementDeps,
): Promise<Result<void, TransactionError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotReady" });
  }

  if (input.transactionId.trim().length === 0) {
    return err({ kind: "UnknownReference" });
  }

  if (input.transferId !== null && input.transferId.trim().length > 0) {
    return err({ kind: "TransferNotEditable" });
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

  const changed = await deps.transactions.update(
    input.workspaceId,
    input.transactionId,
    draft.value,
  );

  if (!changed.ok) return err(changed.error);

  if (changed.value === 0) {
    // Someone else's movement, a transfer leg the policy filtered out, or a row
    // that is already gone. All three mean the caller may not do this, and telling
    // them apart would leak whether the row exists.
    return err({ kind: "NotPermitted" });
  }

  return ok(undefined);
}
