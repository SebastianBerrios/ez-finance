// auth-error.ts — opaque AuthError union
// SECURITY: variants are intentionally coarse so no single variant reveals
// email existence, auth method, or any infrastructure detail.

export type AuthError =
  | { kind: "InvalidEmail" } // format-only, pre-network — safe
  | { kind: "WeakPassword" } // policy-only, pre-network — safe
  | { kind: "AuthenticationFailed" } // login fail, wrong method, linking rejected, user-not-found, UNCONFIRMED email — ALL collapse here
  | { kind: "RateLimited" }
  | { kind: "SessionExpired" }
  | { kind: "ReauthRequired" } // secure_password_change / sensitive op needs recent login
  | { kind: "ConflictOrRejected" } // change-email-to-existing, same-password, generic rejection (no "email taken")
  | { kind: "Unavailable" }; // network/5xx/unknown — never leak provider detail

export function isAuthError(e: unknown): e is AuthError {
  if (e === null || typeof e !== "object") return false;
  const obj = e as Record<string, unknown>;
  const { kind } = obj;
  if (typeof kind !== "string") return false;
  return (
    kind === "InvalidEmail" ||
    kind === "WeakPassword" ||
    kind === "AuthenticationFailed" ||
    kind === "RateLimited" ||
    kind === "SessionExpired" ||
    kind === "ReauthRequired" ||
    kind === "ConflictOrRejected" ||
    kind === "Unavailable"
  );
}

/**
 * Normalize a raw error code/message into a set of alphanumeric tokens.
 * Splits on any non-alphanumeric boundary (whitespace, `:`, `-`, etc.) so
 * that multi-token phrases and punctuation-delimited codes are matched by
 * exact token membership rather than loose substring scanning.
 */
function tokenize(raw: string): ReadonlySet<string> {
  return new Set(
    raw
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0),
  );
}

/** True when every token of `code` (split on `_`) is present in `tokens`. */
function hasCode(tokens: ReadonlySet<string>, code: string): boolean {
  return code.split("_").every((part) => tokens.has(part));
}

function hasAnyCode(tokens: ReadonlySet<string>, codes: string[]): boolean {
  return codes.some((code) => hasCode(tokens, code));
}

/**
 * classify() — maps a raw Supabase/infrastructure error code string to an
 * AuthError kind WITHOUT leaking which email/method caused the error.
 *
 * This is the SINGLE source of truth for the mapping. Infrastructure adapters
 * call this function; they never produce AuthError kinds themselves.
 *
 * Matching is done against normalized, tokenized error codes (exact token
 * membership) rather than loose natural-language substrings, so an unrelated
 * message (e.g. one merely containing the words "no user") or a multi-token
 * code cannot misroute. Ordering is deliberate: benign conflicts are checked
 * before validation so a compound code like "validation_failed: email_exists"
 * resolves to the conflict, never a leak.
 *
 * Rule: unknown inputs → Unavailable (fail closed, never echo the raw code).
 */
export function classify(rawCode: string): AuthError {
  const tokens = tokenize(rawCode);

  // Authentication failures — intentionally collapsed (non-enumeration).
  // email_not_confirmed collapses here too: the login path must NEVER reveal
  // that an email exists-but-unconfirmed (that would be an enumeration oracle).
  if (
    hasAnyCode(tokens, [
      "invalid_credentials",
      "user_not_found",
      "email_not_confirmed",
    ]) ||
    hasCode(tokens, "authentication_failed")
  ) {
    return { kind: "AuthenticationFailed" };
  }

  // Rate limiting — any code carrying both "rate" and "limit" tokens.
  if (tokens.has("rate") && tokens.has("limit")) {
    return { kind: "RateLimited" };
  }

  // Benign conflict / rejection — checked BEFORE validation so a compound
  // "validation_failed: email_exists" resolves to conflict, not InvalidEmail.
  // same_password is a benign rejection, NOT a re-auth requirement.
  if (
    hasAnyCode(tokens, [
      "email_exists",
      "email_taken",
      "conflict",
      "same_password",
    ])
  ) {
    return { kind: "ConflictOrRejected" };
  }

  if (hasAnyCode(tokens, ["session_not_found", "jwt_expired"])) {
    return { kind: "SessionExpired" };
  }

  if (hasCode(tokens, "reauthentication_needed")) {
    return { kind: "ReauthRequired" };
  }

  if (hasCode(tokens, "weak_password")) {
    return { kind: "WeakPassword" };
  }

  if (hasCode(tokens, "validation_failed")) {
    return { kind: "InvalidEmail" };
  }

  return { kind: "Unavailable" };
}
