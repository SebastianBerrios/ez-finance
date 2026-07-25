// bootstrap.ts — server-side helper that resolves an authenticated entry:
// either the caller's Personal workspace id, or the terminal DELETED state.
// Must be called right after a user's first authenticated load.
// Uses getUser() first per vercel-react-best-practices (server-auth-actions).
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result, err, ok } from "@/shared/domain/result";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";

import { mapSupabaseError } from "./error-map";

/**
 * What an authenticated entry resolved to.
 *
 * DELETED is terminal: the grace window expired and the data is gone. It is NOT
 * a variant of READY with an empty workspace — bootstrap() deliberately does
 * not run, because recreating the profile and a fresh 'Personal' workspace
 * would hand the user a working empty account with no hint that everything they
 * had was destroyed, and would make the terminal state unreachable.
 */
export type AuthenticatedEntry =
  | { readonly kind: "READY"; readonly workspaceId: string }
  | { readonly kind: "DELETED" };

/**
 * The distinct message ez_finance.bootstrap() raises instead of re-provisioning
 * an account whose erasure has not been acknowledged. See migration
 * 20260725164257.
 */
const ACCOUNT_DELETED = "account_deleted";

function isAccountDeleted(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { message } = error as { message?: unknown };
  return typeof message === "string" && message.includes(ACCOUNT_DELETED);
}

/** The `state` field of the deletion_state() jsonb payload, or null. */
function readState(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const { state } = payload as { state?: unknown };
  return typeof state === "string" ? state : null;
}

/**
 * bootstrapUserWorkspace — idempotent.
 *
 * 1. Reads ez_finance.deletion_state(). DELETED is PERSISTED state, so ANY
 *    authenticated entry after finalization reaches the terminal notice, no
 *    matter WHO finalized it. Deriving it from "did this call erase the data"
 *    is unreachable in the dominant path: the scheduled worker finalizes the
 *    request out of band, so the user's own sweep always returns false, and a
 *    discarded Next.js prefetch render can consume the one call that returns
 *    true. Either way the account used to be silently re-provisioned.
 * 2. Sweeps a still-open window (pg_cron is not available in the shared
 *    project), so a user who comes back after the deadline is finalized on the
 *    spot instead of waiting for the next cron run.
 * 3. Calls ez_finance.bootstrap(), which returns the existing Personal
 *    workspace or creates profile + workspace + owner membership atomically.
 *
 * Validates authentication server-side before any RPC (getUser() first), and
 * issues the RPCs on the SAME client that performed that validation — getUser()
 * can refresh the access token, and a second client would send the stale one.
 */
export async function bootstrapUserWorkspace(): Promise<
  Result<AuthenticatedEntry, AuthError>
> {
  try {
    // Memoized per request so the page this layout wraps does not pay for a
    // second round trip to the Auth server.
    const { supabase, user, error: userError } = await getAuthenticatedUser();

    if (userError) return err(mapSupabaseError(userError));
    if (!user) return err({ kind: "SessionExpired" });

    const { data: stateData, error: stateError } =
      await supabase.rpc("deletion_state");

    if (stateError) {
      // Non-fatal: ez_finance.bootstrap() refuses on its own when the account
      // was erased, so a failed read here cannot resurrect it. Logged because
      // a permanently failing lifecycle read hides the terminal state.
      console.error("[auth/bootstrap] deletion_state failed:", stateError);
    }

    const state = stateError ? null : readState(stateData);

    if (state === "DELETED") {
      return ok({ kind: "DELETED" });
    }

    // ACTIVE means the ledger holds no request at all, so the sweep can only
    // find nothing. Any other state (including an unreadable one) still gets
    // swept: it MUST run before bootstrap(), or a finalization landing right
    // after would erase the profile bootstrap just recreated.
    if (state !== "ACTIVE") {
      const { data: swept, error: sweepError } = await supabase.rpc(
        "process_deletion_if_due",
      );

      if (sweepError) {
        // Non-fatal on purpose — the request stays pending and the next
        // authenticated entry (or the cron worker) retries it. But it is
        // LOGGED: a permanently failing sweep means data is being retained past
        // the date the UI promised, and silence is how that goes unnoticed.
        console.error(
          "[auth/bootstrap] process_deletion_if_due failed:",
          sweepError,
        );
      }

      if (swept === true) {
        return ok({ kind: "DELETED" });
      }
    }

    // Call the bootstrap RPC — returns uuid (workspace_id)
    const { data, error } = await supabase.rpc("bootstrap");

    if (error) {
      // Backstop for the race the per-user advisory lock serializes: the
      // erasure committed between the state read and this call.
      if (isAccountDeleted(error)) return ok({ kind: "DELETED" });
      return err(mapSupabaseError(error));
    }
    if (!data) return err({ kind: "Unavailable" });

    return ok({ kind: "READY", workspaceId: data as string });
  } catch (e) {
    return err(mapSupabaseError(e));
  }
}
