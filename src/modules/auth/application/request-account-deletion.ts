import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type GracePeriod } from "@/modules/auth/domain/grace-period";
import { type Result, ok } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";
import { type DeletionPort } from "./ports/deletion-port";

interface RequestAccountDeletionInput {
  userId: string;
}

interface RequestAccountDeletionDeps {
  deletion: DeletionPort;
  auth: AuthPort;
}

export interface RequestAccountDeletionOutcome {
  readonly grace: GracePeriod;
  /**
   * false when the deletion was registered but the sign-out failed. The caller
   * MUST NOT redirect to an auth page in that case: the middleware sees a live
   * session on /login and bounces straight back to /app, swallowing the notice
   * and leaving the user signed in to an account scheduled for deletion with
   * no feedback at all.
   */
  readonly signedOut: boolean;
}

export async function requestAccountDeletion(
  input: RequestAccountDeletionInput,
  deps: RequestAccountDeletionDeps,
): Promise<Result<RequestAccountDeletionOutcome, AuthError>> {
  const result = await deps.deletion.request(input.userId);
  if (!result.ok) return result;

  // Close this browser's session after a successful deletion request. Scope is
  // "local" on purpose: mvp-lab shares auth.users across the fleet, so a global
  // sign-out would kick the person out of the other apps too.
  const signOut = await deps.auth.logout("local");

  // A failed sign-out does NOT undo the request — the grace window is already
  // open in the database and cancelling is a separate, deliberate action.
  return ok({ grace: result.value, signedOut: signOut.ok });
}
