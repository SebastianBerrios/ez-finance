import type {
  SingleEntryKind,
  TransactionDraft,
} from "@/modules/transactions/domain/transaction-draft";
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

/**
 * One movement as its EDIT FORM needs it — ids, not names.
 *
 * Deliberately a different shape from `Movement`, which exists for a list and
 * resolves names for display. A form has to preselect the account and category
 * options, and a name cannot do that. Its kind excludes "transfer" because a leg is
 * not editable at all (see TransferNotEditable).
 */
export interface EditableMovement {
  readonly id: string;
  readonly kind: SingleEntryKind;
  readonly baseAmountMinorUnits: bigint;
  readonly occurredOn: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly note: string | null;
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
   * Read one income or expense by id, for its edit form.
   *
   * `viewerId` is not a courtesy: RLS lets every role of the workspace SELECT every
   * movement, so a readable row is not an editable one. Returning NotPermitted for
   * someone else's row here is what stops the form from opening on something the
   * UPDATE would then silently refuse.
   *
   * Answers TransferNotEditable for a leg and UnknownReference when there is no
   * such row in this workspace.
   */
  findEditable(
    workspaceId: string,
    transactionId: string,
    viewerId: string,
  ): Promise<Result<EditableMovement, TransactionError>>;

  /**
   * Overwrite one income or expense. Returns the number of rows actually changed.
   *
   * THE COUNT IS THE POINT, exactly as with deleteOne: an UPDATE that RLS refuses
   * matches zero rows WITHOUT raising, so a caller that only checked for an error
   * would report a saved edit that never happened.
   */
  update(
    workspaceId: string,
    transactionId: string,
    draft: TransactionDraft,
  ): Promise<Result<number, TransactionError>>;

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
