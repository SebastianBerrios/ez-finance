import type { TransactionDraft } from "@/modules/transactions/domain/transaction-draft";
import type { TransactionError } from "@/modules/transactions/domain/transaction-error";
import type { Result } from "@shared/domain/result";

export interface TransactionRef {
  readonly id: string;
}

/**
 * One movement as a list shows it — names resolved, not ids.
 *
 * `transferId` is what tells a caller that deleting this row means deleting a PAIR.
 * `isMine` exists because spec §4 scopes editing to your own movements: a shared
 * workspace shows everyone's, and hiding the controls beats offering a button that
 * silently does nothing (a denied DELETE affects zero rows without raising).
 */
export interface Movement {
  readonly id: string;
  readonly kind: "income" | "expense" | "transfer";
  readonly amountMinorUnits: bigint;
  readonly occurredOn: string;
  readonly accountName: string;
  readonly categoryName: string | null;
  readonly note: string | null;
  readonly transferId: string | null;
  readonly transferLeg: "out" | "in" | null;
  readonly isMine: boolean;
}

export interface TransactionPort {
  /**
   * Write one income or expense.
   *
   * `authorId` is passed in rather than read inside the adapter because RLS
   * requires `created_by = auth.uid()` — the caller already resolved the session,
   * and a second lookup could disagree with the cookie the write travels on.
   *
   * The entered amount equals the base amount: the app is single-currency, so the
   * frozen rate is 1. The columns for a differing currency exist and are enforced
   * (spec §5.5) but nothing writes them yet, so the adapter fills them from the
   * base rather than pretending to convert.
   */
  record(
    workspaceId: string,
    draft: TransactionDraft,
    authorId: string,
  ): Promise<Result<TransactionRef, TransactionError>>;

  /** The month's movements, newest first. */
  listForMonth(
    workspaceId: string,
    month: Date,
    viewerId: string,
  ): Promise<Result<readonly Movement[], TransactionError>>;

  /**
   * Delete one non-transfer row. Returns the number of rows actually removed.
   *
   * THE COUNT IS THE POINT. A DELETE that RLS refuses affects zero rows WITHOUT
   * raising, so a caller that only checked for an error would report success on a
   * forbidden deletion. Anything other than 1 means it did not happen.
   */
  deleteOne(
    workspaceId: string,
    transactionId: string,
  ): Promise<Result<number, TransactionError>>;

  /**
   * Delete BOTH legs of a transfer, through the RPC that owns that invariant.
   * Returns the rows removed — 2 on success, 0 when the pair is not the caller's.
   */
  deleteTransfer(transferId: string): Promise<Result<number, TransactionError>>;
}
