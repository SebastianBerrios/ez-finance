"use client";
// client.ts — browser Supabase client factory
// SCAFFOLD ONLY — not invoked during Fase 0 builds
// Call-time env reads via getSupabaseEnv() (never module-level)
import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./env";

export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
