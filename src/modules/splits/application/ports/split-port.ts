import type { SplitDraft } from "@/modules/splits/domain/split-draft";
import type { SplitError } from "@/modules/splits/domain/split-error";
import type { Result } from "@shared/domain/result";

export type { SplitError };

export interface SplitRef {
  readonly id: string;
}

/** One outstanding (or settled) debt, as the "Te deben" list shows it. */
export interface OwedSplit {
  readonly id: string;
  readonly debtorName: string;
  readonly amountMinorUnits: bigint;
  /** The expense it came from — names resolved, not ids. */
  readonly expenseNote: string | null;
  readonly categoryName: string | null;
  readonly occurredOn: string;
  readonly settled: boolean;
}

export interface SplitPort {
  /**
   * Record one shared expense: your share, the transfer of what you are owed, and who
   * owes it — in ONE database transaction.
   *
   * Goes through the ez_finance.record_split_expense RPC rather than three writes,
   * because two of the three MOVE MONEY. A client doing them separately would, on any
   * failure between them, leave a workspace where money left an account and nothing
   * explains part of it — and no screen could tell.
   *
   * Returns the expense's id, or null when your share was zero and no expense row was
   * written.
   */
  recordSplitExpense(
    workspaceId: string,
    draft: SplitDraft,
  ): Promise<Result<SplitRef | null, SplitError>>;

  /**
   * What people still owe, newest first, plus what was already settled.
   *
   * `settled` is carried rather than filtered out here so one read serves both lists
   * and the screen decides — a second query for "already paid" would be a second
   * chance to disagree about the same rows.
   */
  listOwed(
    workspaceId: string,
  ): Promise<Result<readonly OwedSplit[], SplitError>>;

  /**
   * Someone paid you back: move the money out of "Por cobrar" and stamp the row.
   *
   * Also one RPC, for the same reason. A stamp without the transfer says the debt
   * closed and loses the money; a transfer without the stamp leaves the debt open and
   * double-counts it next time.
   */
  settle(
    workspaceId: string,
    splitId: string,
    toAccountId: string,
    occurredOn: string,
  ): Promise<Result<void, SplitError>>;
}
