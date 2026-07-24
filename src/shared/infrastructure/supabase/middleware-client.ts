// middleware-client.ts — Supabase client factory for middleware
// Wires cookie get/set to the request/response objects.
// Contains NO auth logic — factory only.
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabaseEnv } from "./env";

export function createMiddlewareClient(
  request: NextRequest,
  response: NextResponse,
) {
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    db: { schema: "ez_finance" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: CookieOptions;
        }>,
      ) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          if (options !== undefined) {
            response.cookies.set(name, value, options);
          } else {
            response.cookies.set(name, value);
          }
        });
      },
    },
  });
}
