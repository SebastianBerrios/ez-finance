// auth-error.ts — opaque AuthError union
// SECURITY: variants are intentionally coarse so no single variant reveals
// email existence, auth method, or any infrastructure detail.

export type AuthError =
  | { kind: "InvalidEmail" } // format-only, pre-network — safe
  | { kind: "WeakPassword" } // policy-only, pre-network — safe
  | { kind: "AuthenticationFailed" } // login fail, wrong method, linking rejected, user-not-found — ALL collapse here
  | { kind: "EmailNotConfirmed" } // generic "check your inbox"
  | { kind: "RateLimited" }
  | { kind: "SessionExpired" }
  | { kind: "ReauthRequired" } // secure_password_change / sensitive op needs recent login
  | { kind: "ConflictOrRejected" } // change-email-to-existing, generic rejection (no "email taken")
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
    kind === "EmailNotConfirmed" ||
    kind === "RateLimited" ||
    kind === "SessionExpired" ||
    kind === "ReauthRequired" ||
    kind === "ConflictOrRejected" ||
    kind === "Unavailable"
  );
}

/**
 * classify() — maps a raw Supabase/infrastructure error code string to an
 * AuthError kind WITHOUT leaking which email/method caused the error.
 *
 * This is the SINGLE source of truth for the mapping. Infrastructure adapters
 * call this function; they never produce AuthError kinds themselves.
 *
 * Rule: unknown inputs → Unavailable (fail closed, never leak).
 */
export function classify(rawCode: string): AuthError {
  const code = rawCode.toLowerCase();

  // Authentication failures — intentionally collapsed (non-enumeration)
  if (
    code.includes("invalid_credentials") ||
    code.includes("user_not_found") ||
    code.includes("authentication failed")
  ) {
    return { kind: "AuthenticationFailed" };
  }

  if (code.includes("email_not_confirmed")) {
    return { kind: "EmailNotConfirmed" };
  }

  if (code.includes("rate_limit") || code.includes("over_email_send_rate")) {
    return { kind: "RateLimited" };
  }

  if (
    code.includes("session_not_found") ||
    code.includes("jwt expired") ||
    code.includes("no user")
  ) {
    return { kind: "SessionExpired" };
  }

  if (
    code.includes("reauthentication_needed") ||
    code.includes("same_password")
  ) {
    return { kind: "ReauthRequired" };
  }

  if (
    code.includes("email_exists") ||
    code.includes("email_taken") ||
    code.includes("conflict")
  ) {
    return { kind: "ConflictOrRejected" };
  }

  if (code.includes("weak_password")) {
    return { kind: "WeakPassword" };
  }

  if (code.includes("validation_failed")) {
    return { kind: "InvalidEmail" };
  }

  return { kind: "Unavailable" };
}
