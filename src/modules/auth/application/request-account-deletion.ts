import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type GracePeriod } from "@/modules/auth/domain/grace-period";
import { type Result } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";
import { type DeletionPort } from "./ports/deletion-port";

interface RequestAccountDeletionInput {
  userId: string;
}

interface RequestAccountDeletionDeps {
  deletion: DeletionPort;
  auth: AuthPort;
}

export async function requestAccountDeletion(
  input: RequestAccountDeletionInput,
  deps: RequestAccountDeletionDeps,
): Promise<Result<GracePeriod, AuthError>> {
  const result = await deps.deletion.request(input.userId);
  if (!result.ok) return result;

  // Close all sessions after a successful deletion request
  await deps.auth.logout();

  return result;
}
