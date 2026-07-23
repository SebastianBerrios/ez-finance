import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result } from "@/shared/domain/result";

import { type DeletionPort } from "./ports/deletion-port";

interface CancelAccountDeletionInput {
  userId: string;
}

interface CancelAccountDeletionDeps {
  deletion: DeletionPort;
}

export async function cancelAccountDeletion(
  input: CancelAccountDeletionInput,
  deps: CancelAccountDeletionDeps,
): Promise<Result<void, AuthError>> {
  return deps.deletion.cancel(input.userId);
}
