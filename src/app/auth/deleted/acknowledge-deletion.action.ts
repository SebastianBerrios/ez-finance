"use server";

import { redirect } from "next/navigation";

import { getAccountDeletionStatus } from "@/modules/auth/application/get-account-deletion-status";
import { logout } from "@/modules/auth/application/logout";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";
import { SupabaseDeletionAdapter } from "@/modules/auth/infrastructure/supabase-deletion-adapter";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";

export interface AcknowledgeDeletionState {
  error?: string;
}

const COULD_NOT_SIGN_OUT =
  "No pudimos cerrar tu sesión, así que tampoco cerramos este aviso. " +
  "Intentá de nuevo en unos minutos y, si seguís con problemas, cerrá el navegador.";

const COULD_NOT_READ_STATE =
  "No pudimos confirmar el estado de tu cuenta, así que no hicimos nada. " +
  "Volvé a intentarlo en unos minutos.";

/**
 * "I saw the notice" — the terminal exit for an account whose grace period ran
 * out and whose ez finance data has been erased.
 *
 * WHY AN ACTION AND NOT THE GET ROUTE HANDLER IT REPLACED: the handler was an
 * unauthenticated-reachable, state-mutating GET with no CSRF protection. A
 * cross-site `<img src="/auth/deleted">` aimed at someone in the DELETED state
 * fired the acknowledgement and the sign-out — consuming the one-shot terminal
 * notice without ever showing it. A Server Action is POST-only and origin
 * checked, and it can still write cookies, which a Server Component cannot.
 *
 * WHY THE SIGN-OUT COMES FIRST: acknowledging first and then failing to close
 * the session is the worst outcome available. The session survives, the
 * middleware bounces the still-authenticated user off /login back to /app,
 * deletion_state() now reports ACTIVE (just acknowledged), bootstrap() no longer
 * refuses, and the person is silently handed a fresh empty account —
 * permanently, because the acknowledgement is one-shot. The other order can only
 * fail into "the notice shows again next time", which costs nothing.
 */
export async function acknowledgeDeletionAction(
  _prev?: AcknowledgeDeletionState,
  _formData?: FormData,
): Promise<AcknowledgeDeletionState> {
  const { supabase, user } = await getAuthenticatedUser();

  // No session: nothing to close and nothing to announce.
  if (!user) {
    redirect("/login");
  }

  const deletion = new SupabaseDeletionAdapter();
  const status = await getAccountDeletionStatus({ userId: user.id }, { deletion });

  if (!status.ok) {
    // Fail closed, and STAY PUT. Redirecting to /app would bounce off the (app)
    // layout straight back to this page for as long as the read keeps failing.
    console.error("[auth/deleted] lifecycle read failed:", status.error);
    return { error: COULD_NOT_READ_STATE };
  }

  if (status.value.state !== "DELETED") {
    // A live account — ACTIVE, or still inside its grace window. Nothing to
    // acknowledge and nobody to sign out.
    redirect("/app");
  }

  // Captured BEFORE the sign-out on purpose: acknowledge_deletion() derives the
  // user from auth.uid(), and the cookie session will be gone in a moment.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;

  if (!accessToken) {
    // Signing out now would leave the state terminal with no way to stamp it,
    // and the person stuck on this notice. Do nothing instead.
    console.error(
      "[auth/deleted] no access token to acknowledge with — refusing to sign out",
    );
    return { error: COULD_NOT_READ_STATE };
  }

  // Through the use case, not the adapter: "always local scope" lives in ONE
  // place. mvp-lab shares auth.users with the rest of the fleet, so only the
  // ez finance data is gone — the identity still belongs to the other apps.
  const signedOut = await logout({ auth: new SupabaseAuthAdapter() });

  if (!signedOut.ok) {
    console.error("[auth/deleted] sign-out after erasure failed:", signedOut.error);
    return { error: COULD_NOT_SIGN_OUT };
  }

  const acknowledged = await new SupabaseDeletionAdapter({
    accessToken,
  }).acknowledge(user.id);

  if (!acknowledged.ok) {
    // Not fatal: the state stays terminal, so the next authenticated entry
    // lands on this notice again and retries. Logged because a PERMANENT
    // failure means a user who can never start a fresh account.
    console.error(
      "[auth/deleted] acknowledging the erasure failed:",
      acknowledged.error,
    );
  }

  // redirect() throws NEXT_REDIRECT — keep it out of try/catch.
  redirect("/login?deletion=completed");
}
