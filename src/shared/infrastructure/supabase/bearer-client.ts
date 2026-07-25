// bearer-client.ts — a Supabase client bound to one explicit access token.
//
// WHY IT EXISTS: /auth/deleted has to close the session BEFORE it stamps the
// erasure as acknowledged. Doing it the other way round spends a one-shot fact
// on a session that may survive, and a surviving session walks straight back
// into a freshly bootstrapped empty account. But acknowledge_deletion() derives
// the user from auth.uid(), and the cookie session is gone by then — hence a
// client carrying the access token captured before the sign-out.
//
// That token keeps working: `signOut({ scope: "local" })` revokes the session's
// refresh token, while PostgREST validates the access token's signature and
// expiry locally and never consults auth.sessions. It is a short-lived, already
// issued end-user token, NOT a root credential — this is not the service key.
import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./env";

export function createBearerClient(accessToken: string) {
  const { url, anonKey } = getSupabaseEnv();

  return createClient(url, anonKey, {
    db: { schema: "ez_finance" },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    // No storage, no refresh: this client is one call long and must never
    // resurrect the session the caller just closed.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
