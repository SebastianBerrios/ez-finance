import type { TransactionDraft } from "@/modules/transactions/domain/transaction-draft";
import type { TransactionError } from "@/modules/transactions/domain/transaction-error";
import type { Result } from "@shared/domain/result";

export interface TransactionRef {
  readonly id: string;
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
}
