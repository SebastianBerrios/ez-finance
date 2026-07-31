import type { TransactionError } from "@/modules/transactions/domain/transaction-error";
import { err, ok, type Result } from "@shared/domain/result";

import type { TransactionPort } from "./ports/transaction-port";

interface DeleteMovementInput {
  readonly workspaceId: string;
  readonly transactionId: string;
  /** Present when the movement is one leg of a transfer. */
  readonly transferId: string | null;
}

interface DeleteMovementDeps {
  readonly transactions: TransactionPort;
}

/**
 * Delete a movement — and, if it is a transfer, both of its legs.
 *
 * TWO THINGS THIS EXISTS TO GET RIGHT.
 *
 * A transfer is a tied pair (spec §5.5). Deleting one leg would leave a workspace
 * where money left an account and arrived nowhere, so a row carrying a transferId
 * goes through the RPC that removes both or neither — never through the single-row
 * delete.
 *
 * And ZERO ROWS DELETED IS A FAILURE, not a success. RLS refuses a DELETE by
 * filtering the row out: nothing is removed and nothing is raised. A caller that
 * only checked for an error would tell someone their movement is gone while it is
 * still on the next screen, so the count is what decides.
 */
export async function deleteMovement(
  input: DeleteMovementInput,
  deps: DeleteMovementDeps,
): Promise<Result<void, TransactionError>> {
  if (input.transactionId.trim().length === 0) {
    return err({ kind: "UnknownReference" });
  }

  const removed =
    input.transferId === null
      ? await deps.transactions.deleteOne(
          input.workspaceId,
          input.transactionId,
        )
      : await deps.transactions.deleteTransfer(input.transferId);

  if (!removed.ok) return err(removed.error);

  if (removed.value === 0) {
    // Either it is someone else's movement or it is already gone. Both mean the
    // caller may not do this, and neither is worth telling apart — distinguishing
    // them would leak whether the row exists.
    return err({ kind: "NotPermitted" });
  }

  return ok(undefined);
}
