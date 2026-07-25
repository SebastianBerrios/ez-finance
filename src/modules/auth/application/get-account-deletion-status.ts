import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result } from "@/shared/domain/result";

import { type DeletionPort, type DeletionStatus } from "./ports/deletion-port";

interface GetAccountDeletionStatusInput {
  userId: string;
}

interface GetAccountDeletionStatusDeps {
  deletion: DeletionPort;
}

/**
 * Read the account lifecycle status so the UI can show either the danger zone
 * (ACTIVE) or the pending-deletion banner with its deadline (GRACE_PERIOD).
 */
export async function getAccountDeletionStatus(
  input: GetAccountDeletionStatusInput,
  deps: GetAccountDeletionStatusDeps,
): Promise<Result<DeletionStatus, AuthError>> {
  return deps.deletion.getState(input.userId);
}
