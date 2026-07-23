import { type AuthError } from "@/modules/auth/domain/auth-error";
import { email as emailVo } from "@/modules/auth/domain/email";
import { type Result, ok } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";

interface RequestPasswordRecoveryInput {
  email: string;
}

interface RequestPasswordRecoveryDeps {
  auth: AuthPort;
}

/**
 * NON-ENUMERATING: ALWAYS returns ok(void) regardless of whether the email
 * exists, uses Google, or any other backend state. This prevents account
 * existence enumeration via the recovery flow.
 */
export async function requestPasswordRecovery(
  input: RequestPasswordRecoveryInput,
  deps: RequestPasswordRecoveryDeps,
): Promise<Result<void, AuthError>> {
  const emailResult = emailVo.create(input.email);
  if (emailResult.ok) {
    // Attempt recovery but swallow all errors
    await deps.auth.requestPasswordRecovery(emailResult.value).catch(() => {
      // intentionally swallowed
    });
  }
  // Always return generic ok — no enumeration possible
  return ok(undefined);
}
