import { NAME_MAX } from "@/modules/accounts/domain/account-draft";
import type { AccountError } from "@/modules/accounts/domain/account-error";
import { err, type Result } from "@shared/domain/result";

import type { AccountPort } from "./ports/account-port";

interface RenameAccountInput {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly name: string;
}

interface RenameAccountDeps {
  readonly accounts: AccountPort;
}

/**
 * Change an account's name.
 *
 * ONLY the name. The type stays put because the engine reads it to decide whether a
 * transfer INTO the account consumes the savings bucket — changing it would silently
 * re-interpret every transfer already recorded against it — and the currency belongs to
 * the workspace and is immutable.
 *
 * Empty and too-long collapse into InvalidAccountName because that is the one kind this
 * module's error union offers for a bad name; categories split them, accounts do not,
 * and inventing a new kind here would make the two modules disagree about their own
 * vocabulary.
 */
export async function renameAccount(
  input: RenameAccountInput,
  deps: RenameAccountDeps,
): Promise<Result<void, AccountError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  if (input.accountId.trim().length === 0) {
    return err({ kind: "NotPermitted" });
  }

  const name = input.name.trim();

  if (name.length === 0 || name.length > NAME_MAX) {
    return err({ kind: "InvalidAccountName" });
  }

  return deps.accounts.rename(input.workspaceId, input.accountId, name);
}
