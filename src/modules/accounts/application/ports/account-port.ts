import type { AccountDraft } from "@/modules/accounts/domain/account-draft";
import type { AccountError } from "@/modules/accounts/domain/account-error";
import type { AccountType } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";

export interface AccountRef {
  readonly id: string;
}

/**
 * An account as a list needs it.
 *
 * NO balance field, deliberately. The balance is opening balance plus the signed
 * sum of the account's movements, and the sign rule (income and transfer-in add,
 * expense and transfer-out subtract) is real logic that must exist in exactly one
 * place. It arrives with the dashboard, which already loads a month of
 * transactions for the engine — inventing a second implementation here, in SQL,
 * to decorate a list would be the duplicate.
 */
export interface AccountSummary {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly archived: boolean;
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
}
