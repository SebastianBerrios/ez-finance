import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";

interface LogoutDeps {
  auth: AuthPort;
}

export async function logout(
  deps: LogoutDeps,
): Promise<Result<void, AuthError>> {
  return deps.auth.logout();
}
