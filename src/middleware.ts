// middleware.ts — Supabase session refresh scaffold (inert pass-through in Fase 0)
// Fase 2 will fill in the Supabase session refresh logic here.
// IMPORTANT: Do NOT call createServerClient or read env vars here in Fase 0.
import { type NextRequest, NextResponse } from "next/server";

export function middleware(_request: NextRequest) {
  // Inert pass-through — no Supabase calls, no env reads in Fase 0
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public icons
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/).*)",
  ],
};
