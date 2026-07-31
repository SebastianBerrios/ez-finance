import { accountDraft } from "@/modules/accounts/domain/account-draft";
import type { AccountError } from "@/modules/accounts/domain/account-error";
import { err, type Result } from "@shared/domain/result";

import type { AccountPort, AccountRef } from "./ports/account-port";

interface CreateAccountInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly initialBalanceMinorUnits: bigint;
}

interface CreateAccountDeps {
  readonly accounts: AccountPort;
}

/**
 * Create an account in a workspace.
 *
 * Validation happens HERE rather than being left to the table's CHECK
 * constraints: a bad draft should not cost a round trip, and a constraint
 * violation arrives as an opaque Postgres error that the adapter would have to
 * reverse-engineer into a field-specific message.
 *
 * WORTH KNOWING: for the first account in a workspace this call also fixes that
 * workspace's BASE CURRENCY, which is immutable afterwards. The database adopts it
 * from the account (accounts_set_workspace_base_currency), so the choice made here
 * is permanent for every amount the workspace will ever store.
 */
export async function createAccount(
  input: CreateAccountInput,
  deps: CreateAccountDeps,
): Promise<Result<AccountRef, AccountError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  const draft = accountDraft.create({
    name: input.name,
    type: input.type,
    currency: input.currency,
    initialBalanceMinorUnits: input.initialBalanceMinorUnits,
  });

  if (!draft.ok) {
    return err(draft.error);
  }

  return deps.accounts.create(input.workspaceId, draft.value);
}
