// server.ts — server-side Supabase client factory
// SCAFFOLD ONLY — not invoked during Fase 0 builds
// Uses cookies() from next/headers for request-scoped session management
import { type CookieOptions, createServerClient as createSSRServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "./env";

export async function createServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createSSRServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            if (options !== undefined) {
              cookieStore.set(name, value, options);
            } else {
              cookieStore.set(name, value);
            }
          });
        } catch {
          // Called from a Server Component — ignore set errors
        }
      },
    },
  });
}
