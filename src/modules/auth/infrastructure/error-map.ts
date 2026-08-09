// error-map.ts — Supabase error → AuthError mapping
// SINGLE source of truth for adapter error translation.
// Delegates kind classification to domain/auth-error.ts classify() so the
// mapping logic is covered by domain unit tests.
import { classify, type AuthError } from "@/modules/auth/domain/auth-error";

/**
 * Map any Supabase error (AuthError from @supabase/supabase-js, response
 * error, or unknown thrown value) to a domain AuthError.
 *
 * Nothing from this function leaks Supabase error codes or messages to callers.
 */
export function mapSupabaseError(e: unknown): AuthError {
  if (e === null || e === undefined) {
    return { kind: "Unavailable" };
  }

  // Supabase AuthApiError and AuthError have a `message` and optional `code`
  const raw = e as Record<string, unknown>;

  // Prefer the error code (more stable than message text)
  const code = typeof raw["code"] === "string" ? raw["code"] : "";
  const status = typeof raw["status"] === "number" ? raw["status"] : undefined;
  const message = typeof raw["message"] === "string" ? raw["message"] : "";

  // 429 HTTP status always maps to rate limit
  if (status === 429) {
    return { kind: "RateLimited" };
  }

  // Try the code field first (e.g. "invalid_credentials", "user_not_found")
  if (code) {
    const fromCode = classify(code);
    if (fromCode.kind !== "Unavailable") {
      return fromCode;
    }
  }

  // Fall back to the message string
  if (message) {
    const fromMessage = classify(message);
    if (fromMessage.kind !== "Unavailable") {
      return fromMessage;
    }
  }

  return { kind: "Unavailable" };
}
