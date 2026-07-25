// service-client.ts — SERVER-ONLY Supabase factory holding the service-role key.
//
// The service-role key bypasses RLS entirely. Everything else in this codebase
// goes through the anon/publishable key plus the caller's session, on purpose.
// The ONE legitimate use is the scheduled deletion worker: it finalizes
// accounts that have no session at all, which is exactly why the pull-based
// sweep could never close the dominant path.
//
// `server-only` is not a dependency of this project, so the guard is explicit:
// this module throws the moment it is evaluated in a browser. Any accidental
// import from a Client Component fails loudly at load instead of shipping a
// root credential to every visitor.
import { createClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error(
    "service-client.ts is server-only: it holds SUPABASE_SERVICE_ROLE_KEY and must never reach a browser bundle",
  );
}

/**
 * Build a service-role client scoped to the ez_finance schema.
 *
 * No session handling: a worker has no user, and persisting or refreshing a
 * session for a root credential would be a way to leak it. Errors never quote
 * the key — only the NAME of the missing variable.
 */
export function createServiceClient() {
  if (typeof window !== "undefined") {
    throw new Error("createServiceClient() must not be called in a browser");
  }

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase service credentials: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only)",
    );
  }

  return createClient(url, serviceRoleKey, {
    db: { schema: "ez_finance" },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
