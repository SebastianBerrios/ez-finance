import { type Result, err, ok } from "@/shared/domain/result";

import { type AuthError } from "./auth-error";

// RFC 5321-ish regex: local@domain.tld
// Intentionally pragmatic — rejects clearly malformed addresses.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Email {
  readonly value: string;
}

function create(raw: string): Result<Email, AuthError> {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !EMAIL_REGEX.test(trimmed)) {
    return err({ kind: "InvalidEmail" } satisfies AuthError);
  }
  return ok({ value: trimmed });
}

export const email = { create } as const;
