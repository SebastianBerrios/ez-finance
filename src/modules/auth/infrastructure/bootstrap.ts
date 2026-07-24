// bootstrap.ts — server-side helper that calls ez_finance.bootstrap() RPC
// Returns the Personal workspace ID for the authenticated user.
// Must be called right after a user's first authenticated load.
// Uses getUser() first per vercel-react-best-practices (server-auth-actions).
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result, err, ok } from "@/shared/domain/result";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

import { mapSupabaseError } from "./error-map";

/**
 * bootstrapUserWorkspace — idempotent.
 * Calls ez_finance.bootstrap() which:
 *   1. Returns existing Personal workspace_id if already bootstrapped.
 *   2. Creates profile + Personal workspace + owner membership atomically.
 *
 * Validates authentication server-side before the RPC call (getUser() first).
 */
export async function bootstrapUserWorkspace(): Promise<
  Result<{ workspaceId: string }, AuthError>
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

    // Call the bootstrap RPC — returns uuid (workspace_id)
    const { data, error } = await supabase.rpc("bootstrap");

    if (error) return err(mapSupabaseError(error));
    if (!data) return err({ kind: "Unavailable" });

    return ok({ workspaceId: data as string });
  } catch (e) {
    return err(mapSupabaseError(e));
  }
}
