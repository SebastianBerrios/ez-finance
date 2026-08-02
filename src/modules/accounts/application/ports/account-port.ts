import type { AccountDraft } from "@/modules/accounts/domain/account-draft";
import type { AccountError } from "@/modules/accounts/domain/account-error";
import type { AccountType } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";

export interface AccountRef {
  readonly id: string;
}

/**
 * An account without its balance — enough to fill a picker.
 */
export interface AccountSummary {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly archived: boolean;
}

/**
 * An account with its computed balance.
 *
 * CORRECTING AN EARLIER NOTE IN THIS FILE. It used to say the balance would be
 * derived in TypeScript from the month of transactions the dashboard already
 * loads, and that a SQL version would be a duplicate. That was wrong: a balance is
 * the WHOLE history, not one month, so the dashboard's data cannot produce it and
 * deriving it here would mean loading every transaction a workspace ever recorded
 * to render a list.
 *
 * So the sign rule lives once, in ez_finance.account_balances(), covered by
 * supabase/tests/account_balances.sql. There is no TypeScript version to disagree
 * with it.
 */
export interface AccountWithBalance extends AccountSummary {
  /** Signed: an account can legitimately be negative (a card with debt). */
  readonly balanceMinorUnits: bigint;
  /** Zero movements is not the same as movements that net to zero. */
  readonly movementCount: number;
}

export interface AccountPort {
  /**
   * Persist a new account in `workspaceId`.
   *
   * Creating the FIRST account in a workspace also fixes that workspace's base
   * currency — the database adopts it (see the accounts_set_workspace_base_currency
   * trigger), and it is immutable afterwards.
   */
  create(
    workspaceId: string,
    draft: AccountDraft,
  ): Promise<Result<AccountRef, AccountError>>;

  listByWorkspace(
    workspaceId: string,
  ): Promise<Result<readonly AccountSummary[], AccountError>>;

  /**
   * The same accounts, each with its computed balance.
   *
   * Separate from listByWorkspace because a picker does not need the aggregate and
   * should not pay for it — the balance costs a scan of the account's whole history.
   */
  listWithBalances(
    workspaceId: string,
  ): Promise<Result<readonly AccountWithBalance[], AccountError>>;

  /**
   * Archive an account: stop offering it for new movements, keep everything it holds.
   *
   * NEVER a delete, and the reason is stronger here than for categories. An account's
   * transactions ARE the money — deleting the row would either orphan them or take
   * them with it, and in both cases every balance and every past month silently
   * changes. Archiving leaves the history, and the balance, exactly where it was.
   *
   * The account therefore keeps appearing in lists, marked, WITH its balance. A
   * hidden account whose money still counts toward nothing visible is how someone
   * concludes the app lost it.
   *
   * Deliberately single-id rather than a batch: archiving an account is a considered
   * act about one thing, not a bulk tidy-up like the onboarding category step.
   */
  archive(
    workspaceId: string,
    accountId: string,
  ): Promise<Result<void, AccountError>>;

  /** Clear `archived_at`, offering the account for new movements again. */
  unarchive(
    workspaceId: string,
    accountId: string,
  ): Promise<Result<void, AccountError>>;

  /**
   * Change an account's NAME, and only its name.
   *
   * NOT its type: the engine reads that to decide whether a transfer INTO the account
   * consumes the savings bucket, so changing it would silently re-interpret every
   * transfer already recorded against it. NOT its currency either — that belongs to the
   * workspace and is immutable.
   */
  rename(
    workspaceId: string,
    accountId: string,
    name: string,
  ): Promise<Result<void, AccountError>>;
}
