// auth/callback/route.ts — OAuth authorization code exchange
// Called by Supabase after the Google OAuth redirect.
// This route is EXCLUDED from the middleware matcher so it is always reachable
// by unauthenticated requests (the code exchange IS the authentication).
//
// NOTE: Full end-to-end flow requires the Google provider to be configured
// in the Supabase project (dashboard > Auth > Providers > Google) and
// the redirect URI https://vzxrsvqnxkoiuwvdozxv.supabase.co/auth/v1/callback
// added to the Google OAuth client's authorized redirect URIs.
import { type NextRequest, NextResponse } from "next/server";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  // OAuth provider signalled an error (user cancelled, denied, or provider error).
  // No account is created or modified. Redirect to login with a generic indicator.
  // §8 / REQ-OAUTH-05: cancel mid-flow → back to sign-in, no account touched.
  if (errorParam) {
    return NextResponse.redirect(new URL("/login?error=oauth_cancelled", origin));
  }

  if (!code) {
    // No code and no error — unexpected state. Redirect generically.
    return NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
  }

  const adapter = new SupabaseAuthAdapter();
  const result = await adapter.completeOAuth(code);

  if (!result.ok) {
    // Exchange failed — generic redirect, no detail leaked.
    return NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
  }

  // Session established. Bootstrap the Personal workspace (idempotent).
  // Failure here is non-fatal — the user is authenticated; workspace may exist
  // from a prior login or DB trigger. Log only in dev.
  const bootstrapResult = await bootstrapUserWorkspace();
  if (!bootstrapResult.ok && process.env.NODE_ENV === "development") {
    console.warn("[auth/callback] bootstrapUserWorkspace failed:", bootstrapResult.error);
  }

  // The grace window expired and this sign-in is what erased the data. Sending
  // the user to /app would show them a freshly bootstrapped empty account with
  // no explanation; /auth/deleted closes the session and says what happened.
  if (bootstrapResult.ok && bootstrapResult.value.kind === "DELETED") {
    return NextResponse.redirect(new URL("/auth/deleted", origin));
  }

  return NextResponse.redirect(new URL("/app", origin));
}
