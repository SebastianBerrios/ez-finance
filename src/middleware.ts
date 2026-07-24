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

  // Protected: /app/** requires an authenticated user
  const isApp = path.startsWith("/app");

  // Auth pages: authenticated users should not see login/register
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
     * - api/ (route handlers)
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|auth/callback|api/).*)",
  ],
};
