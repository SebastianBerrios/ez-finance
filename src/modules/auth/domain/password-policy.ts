import { type Result, err, ok } from "@/shared/domain/result";

import { type AuthError } from "./auth-error";
import { type Password, makePassword } from "./password";

const MIN_LENGTH = 10;
const HAS_LETTER = /[a-zA-Z]/;
const HAS_DIGIT = /[0-9]/;

function validate(raw: string): Result<Password, AuthError> {
  if (
    raw.length < MIN_LENGTH ||
    !HAS_LETTER.test(raw) ||
    !HAS_DIGIT.test(raw)
  ) {
    return err({ kind: "WeakPassword" } satisfies AuthError);
  }
  return ok(makePassword(raw));
}

export const passwordPolicy = { validate } as const;
