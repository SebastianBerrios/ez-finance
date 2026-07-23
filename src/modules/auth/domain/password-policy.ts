import { type Result, err, ok } from "@/shared/domain/result";

import { type AuthError } from "./auth-error";
import { type Password, makePassword } from "./password";

const MIN_LENGTH = 10;
// Unicode-aware: accept any Unicode letter (\p{L}) and any Unicode number
// (\p{N}) so accented letters (ñ, é) and non-ASCII digits are honored.
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\p{N}/u;

function validate(raw: string): Result<Password, AuthError> {
  // Count code points (not UTF-16 units) so length is sensible for Unicode;
  // do NOT trim — whitespace-padding handling is intentionally out of scope.
  const codePointLength = [...raw].length;
  if (
    codePointLength < MIN_LENGTH ||
    !HAS_LETTER.test(raw) ||
    !HAS_DIGIT.test(raw)
  ) {
    return err({ kind: "WeakPassword" } satisfies AuthError);
  }
  return ok(makePassword(raw));
}

export const passwordPolicy = { validate } as const;
