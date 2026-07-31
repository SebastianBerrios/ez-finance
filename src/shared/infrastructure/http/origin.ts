import { headers } from "next/headers";

/**
 * Build an origin from a Host header and an optional forwarded protocol.
 * Localhost/loopback defaults to http; everything else defaults to https.
 * Pure and testable — {@link getRequestOrigin} feeds it the live request headers.
 */
export function resolveOrigin(
  host: string | null,
  forwardedProto: string | null,
): string {
  const h = host ?? "localhost:3000";
  const isLocal = h.startsWith("localhost") || h.startsWith("127.0.0.1");
  const proto = forwardedProto ?? (isLocal ? "http" : "https");
  return `${proto}://${h}`;
}

/**
 * The origin of the current request (e.g. `https://ez-finance.vercel.app` in
 * production, `http://localhost:3000` in dev).
 *
 * Every auth link Supabase mails out must be built from this, never from the
 * project's Site URL. mvp-lab is ONE Supabase project shared by the whole
 * fleet, so its Site URL is a single default that belongs to no app in
 * particular — relying on it mails ez finance's users a link into whichever
 * app happens to own it. Deriving the origin per request also means the same
 * code works from localhost, a Vercel preview, and production without a
 * per-environment variable to keep in sync.
 *
 * Whatever origin this returns must be present in the Supabase project's
 * redirect allow-list (Auth > URL Configuration), or Supabase rejects it.
 */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  return resolveOrigin(h.get("host"), h.get("x-forwarded-proto"));
}
