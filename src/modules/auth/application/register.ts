import { type AuthError } from "@/modules/auth/domain/auth-error";
import { email as emailVo } from "@/modules/auth/domain/email";
import { passwordPolicy } from "@/modules/auth/domain/password-policy";
import { type Result, err } from "@/shared/domain/result";

import { type AuthPort } from "./ports/auth-port";

interface RegisterInput {
  email: string;
  password: string;
}

interface RegisterDeps {
  auth: AuthPort;
}

export async function register(
  input: RegisterInput,
  deps: RegisterDeps,
): Promise<Result<void, AuthError>> {
  const emailResult = emailVo.create(input.email);
  if (!emailResult.ok) return err(emailResult.error);

  const passwordResult = passwordPolicy.validate(input.password);
  if (!passwordResult.ok) return err(passwordResult.error);

  return deps.auth.register(emailResult.value, passwordResult.value);
}
