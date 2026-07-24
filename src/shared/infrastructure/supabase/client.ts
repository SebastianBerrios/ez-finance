"use client";
// client.ts — browser Supabase client factory
// All PostgREST/RPC calls target the ez_finance schema.
// Call-time env reads via getSupabaseEnv() (never module-level).
import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./env";

export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey, {
    db: { schema: "ez_finance" },
  });
}
