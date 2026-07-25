// auth/reset-password/route.ts — Password recovery code exchange
// Supabase sends the user to this URL after they click the recovery email link.
// The URL contains ?code=xxx (PKCE recovery code) that must be exchanged
// for a session before the user can set a new password.
//
// This is the same pattern as /auth/callback (OAuth code exchange).
// The route is excluded from the middleware matcher — it must be reachable
// without an active session.
//
// NOTE: Recovery EMAIL delivery is deferred until Resend SMTP is configured.
// This code path (code exchange + redirect to set-password) is correct and ready.
import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@/shared/infrastructure/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    // No code — likely a direct navigation; redirect to forgot-password.
    return NextResponse.redirect(new URL("/forgot-password", origin));
  }

  try {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // Exchange failed (expired link, already used, etc.) — redirect generically.
      return NextResponse.redirect(
        new URL("/forgot-password?error=link_expired", origin),
      );
    }

    // Session established as recovery type.
    // Redirect to the form where the user sets their new password.
    return NextResponse.redirect(new URL("/auth/set-password", origin));
  } catch {
    return NextResponse.redirect(
      new URL("/forgot-password?error=link_expired", origin),
    );
  }
}
