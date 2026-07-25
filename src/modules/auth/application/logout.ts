import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";

interface LogoutDeps {
  auth: AuthPort;
}

export async function logout(
  deps: LogoutDeps,
): Promise<Result<void, AuthError>> {
  // "local": signing out of ez finance must not revoke the sessions the same
  // auth.users row holds for the other mvp-lab apps. See LogoutScope.
  return deps.auth.logout("local");
}
