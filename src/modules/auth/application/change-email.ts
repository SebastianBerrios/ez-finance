import { type AuthError } from "@/modules/auth/domain/auth-error";
import { email as emailVo } from "@/modules/auth/domain/email";
import { type Result, err } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";

interface ChangeEmailInput {
  next: string;
}

interface ChangeEmailDeps {
  auth: AuthPort;
}

export async function changeEmail(
  input: ChangeEmailInput,
  deps: ChangeEmailDeps,
): Promise<Result<void, AuthError>> {
  const emailResult = emailVo.create(input.next);
  if (!emailResult.ok) return err(emailResult.error);

  return deps.auth.changeEmail(emailResult.value);
}
