// auth/deleted/route.ts — terminal exit for an account whose grace period ran
// out and whose data was just erased.
//
// WHY A ROUTE HANDLER AND NOT A REDIRECT FROM THE LAYOUT: the session cookie
// has to go. A Server Component cannot write cookies (next/headers throws on
// mutation outside an Action or a Route Handler), so a bare redirect to /login
// would leave the session alive, the middleware would bounce the still
// authenticated user back to /app, and the (app) layout would bootstrap a
// brand-new empty account. Route handlers can set cookies, so the sign-out
// actually sticks here.
import { type NextRequest, NextResponse } from "next/server";

import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";

export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;

  // "local": mvp-lab shares auth.users with the rest of the fleet. Only the
  // ez finance data is gone; the identity still belongs to the other apps.
  const result = await new SupabaseAuthAdapter().logout("local");

  if (!result.ok) {
    // The data IS erased either way. Log it: a session that outlives the
    // erasure walks straight back into a freshly bootstrapped empty account.
    console.error("[auth/deleted] sign-out after erasure failed:", result.error);
  }

  return NextResponse.redirect(new URL("/login?deletion=completed", origin));
}
