// bootstrap.ts — server-side helper that calls ez_finance.bootstrap() RPC
// Returns the Personal workspace ID for the authenticated user.
// Must be called right after a user's first authenticated load.
// Uses getUser() first per vercel-react-best-practices (server-auth-actions).
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result, err, ok } from "@/shared/domain/result";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

import { mapSupabaseError } from "./error-map";

/**
 * What an authenticated entry resolved to.
 *
 * DELETED is terminal: the grace window expired and this request is the one
 * that erased the data. It is NOT a variant of READY with an empty workspace —
 * bootstrap() deliberately does not run, because recreating the profile and a
 * fresh 'Personal' workspace in the same request would hand the user a working
 * empty account with no hint that everything they had was just destroyed, and
 * would make the terminal state unreachable.
 */
export type AuthenticatedEntry =
  | { readonly kind: "READY"; readonly workspaceId: string }
  | { readonly kind: "DELETED" };

/**
 * bootstrapUserWorkspace — idempotent.
 * Calls ez_finance.bootstrap() which:
 *   1. Returns existing Personal workspace_id if already bootstrapped.
 *   2. Creates profile + Personal workspace + owner membership atomically.
 *
 * Validates authentication server-side before the RPC call (getUser() first).
 */
export async function bootstrapUserWorkspace(): Promise<
  Result<AuthenticatedEntry, AuthError>
> {
  try {
    const supabase = await createServerClient();

    // Validate authentication server-side first (per server-auth-actions rule)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) return err(mapSupabaseError(userError));
    if (!user) return err({ kind: "SessionExpired" });

    // Pull-based deletion finalization (pg_cron is not available in the shared
    // project). This MUST run before bootstrap(): if a due request finalized
    // after the bootstrap, it would erase the profile that bootstrap just
    // recreated.
    const { data: swept, error: sweepError } = await supabase.rpc(
      "process_deletion_if_due",
    );

    if (sweepError) {
      // Non-fatal on purpose — the request stays pending and the next
      // authenticated entry retries it. But it is LOGGED: a permanently failing
      // sweep means data is being retained past the date the UI promised, and
      // silence is how that goes unnoticed for months.
      console.error(
        "[auth/bootstrap] process_deletion_if_due failed:",
        sweepError,
      );
    }

    if (swept === true) {
      // The erasure happened in THIS request. Stop here: the caller signs the
      // user out and routes to the "your data was deleted" notice.
      return ok({ kind: "DELETED" });
    }

    // Call the bootstrap RPC — returns uuid (workspace_id)
    const { data, error } = await supabase.rpc("bootstrap");

    if (error) return err(mapSupabaseError(error));
    if (!data) return err({ kind: "Unavailable" });

    return ok({ kind: "READY", workspaceId: data as string });
  } catch (e) {
    return err(mapSupabaseError(e));
  }
}
