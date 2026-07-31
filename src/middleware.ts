// middleware.ts — Supabase session refresh + route protection
// Uses createMiddlewareClient from shared/infrastructure (no module code here).
import { type NextRequest, NextResponse } from "next/server";

import { createMiddlewareClient } from "@/shared/infrastructure/supabase/middleware-client";

export async function middleware(request: NextRequest) {
  // Create a response we can write cookies into
  const response = NextResponse.next({ request });

  // Refresh the Supabase session (validates + refreshes the access token cookie)
  const supabase = createMiddlewareClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Protected: /app/** and the onboarding wizard both require an authenticated
  // user. /onboarding sits OUTSIDE the (app) group on purpose — that group's
  // layout redirects an unconfigured workspace to the wizard, so hosting the
  // wizard inside it would redirect to itself forever.
  const isApp = path.startsWith("/app") || path.startsWith("/onboarding");

  // Auth pages: authenticated users should not see login/register/forgot-password.
  // /set-password is intentionally excluded: a recovery session is technically
  // "authenticated" but the user must complete password reset before using the app.
  const isAuthPage =
    path === "/login" || path === "/register" || path === "/forgot-password";

  if (isApp && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthPage && user) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  // Return the response that carries the refreshed session cookies
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public icons
     * - auth/callback (OAuth exchange route handler)
     * - auth/reset-password (recovery code exchange route handler — must be
     *   reachable without an active session; the handler establishes the session)
     * - auth/deleted (terminal notice page + its sign-out Server Action — the
     *   middleware writes the refreshed session cookie onto the SAME response,
     *   which would hand back a fresh cookie and clobber the sign-out the
     *   action just performed)
     * - api/ (route handlers)
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|auth/callback|auth/reset-password|auth/deleted|api/).*)",
  ],
};
