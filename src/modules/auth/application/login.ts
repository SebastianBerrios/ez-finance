import { type AuthError } from "@/modules/auth/domain/auth-error";
import { email as emailVo } from "@/modules/auth/domain/email";
import { makePassword } from "@/modules/auth/domain/password";
import { type Result, err } from "@/shared/domain/result";

import { type AuthPort, type SessionRef } from "./ports/auth-port";

interface LoginInput {
  email: string;
  password: string;
}

interface LoginDeps {
  auth: AuthPort;
}

export async function login(
  input: LoginInput,
  deps: LoginDeps,
): Promise<Result<SessionRef, AuthError>> {
  const emailResult = emailVo.create(input.email);
  if (!emailResult.ok) return err(emailResult.error);

  // For login we wrap the raw password as a Password VO without policy validation
  // (the stored credential may pre-date stricter policies).
  // Error mapping is fully delegated to the adapter.
  const password = makePassword(input.password);
  return deps.auth.login(emailResult.value, password);
}
