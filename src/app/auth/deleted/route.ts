// auth/deleted/route.ts — terminal exit for an account whose grace period ran
// out and whose data has been erased.
//
// WHY A ROUTE HANDLER AND NOT A REDIRECT FROM THE LAYOUT: the session cookie
// has to go. A Server Component cannot write cookies (next/headers throws on
// mutation outside an Action or a Route Handler), so a bare redirect to /login
// would leave the session alive, the middleware would bounce the still
// authenticated user back to /app, and the (app) layout would loop.
//
// WHY IT VERIFIES FIRST: this is an unauthenticated-reachable GET with side
// effects and no CSRF protection. A typed URL, a shared link, an <img src>, a
// crawler or the browser Back button all hit it. Signing out whoever asks and
// telling them "we deleted your data" is a lie with a side effect, so nothing
// destructive happens until the CURRENT session is confirmed to carry a
// finalized, unacknowledged deletion.
//
// This route is excluded from the middleware matcher (see src/middleware.ts):
// the middleware refreshes the session on the SAME response object, which would
// hand back a fresh cookie and undo the sign-out below.
import { type NextRequest, NextResponse } from "next/server";

import { getAccountDeletionStatus } from "@/modules/auth/application/get-account-deletion-status";
import { logout } from "@/modules/auth/application/logout";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";
import { SupabaseDeletionAdapter } from "@/modules/auth/infrastructure/supabase-deletion-adapter";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";

export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const { user } = await getAuthenticatedUser();

  // No session: nothing to close and nothing to announce.
  if (!user) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const deletion = new SupabaseDeletionAdapter();
  const status = await getAccountDeletionStatus({ userId: user.id }, { deletion });

  if (!status.ok) {
    // Fail closed. We do not know whether this account was erased, so we do not
    // sign anyone out and we do not claim anything. /app re-reads the state.
    console.error("[auth/deleted] lifecycle read failed:", status.error);
    return NextResponse.redirect(new URL("/app", origin));
  }

  if (status.value.state !== "DELETED") {
    // A live account — ACTIVE, or still inside its grace window. Send it back
    // to the app with no message and no sign-out.
    return NextResponse.redirect(new URL("/app", origin));
  }

  // Acknowledge BEFORE signing out: acknowledge_deletion() derives the user
  // from auth.uid(), so it cannot run once the session is gone. Without it the
  // account stays terminal and the person can never start over.
  const acknowledged = await deletion.acknowledge(user.id);

  if (!acknowledged.ok) {
    // Not fatal: the state stays terminal, so the next authenticated entry
    // lands here again and retries. Logged because a permanent failure means a
    // user who can never start a fresh account.
    console.error(
      "[auth/deleted] acknowledging the erasure failed:",
      acknowledged.error,
    );
  }

  // Through the use case, not the adapter: "always local scope" lives in ONE
  // place. mvp-lab shares auth.users with the rest of the fleet, so only the
  // ez finance data is gone — the identity still belongs to the other apps.
  const signedOut = await logout({ auth: new SupabaseAuthAdapter() });

  if (!signedOut.ok) {
    // The data IS erased either way. Log it: a session that outlives the
    // erasure walks straight back into a freshly bootstrapped empty account.
    console.error("[auth/deleted] sign-out after erasure failed:", signedOut.error);
  }

  return NextResponse.redirect(new URL("/login?deletion=completed", origin));
}
