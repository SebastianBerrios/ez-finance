import { type AuthError } from "@/modules/auth/domain/auth-error";
import { makePassword } from "@/modules/auth/domain/password";
import { passwordPolicy } from "@/modules/auth/domain/password-policy";
import { type Result, err } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";

interface ChangePasswordInput {
  current?: string;
  next: string;
}

interface ChangePasswordDeps {
  auth: AuthPort;
}

export async function changePassword(
  input: ChangePasswordInput,
  deps: ChangePasswordDeps,
): Promise<Result<void, AuthError>> {
  const nextResult = passwordPolicy.validate(input.next);
  if (!nextResult.ok) return err(nextResult.error);

  const current =
    input.current !== undefined ? makePassword(input.current) : null;

  return deps.auth.changePassword(current, nextResult.value);
}
