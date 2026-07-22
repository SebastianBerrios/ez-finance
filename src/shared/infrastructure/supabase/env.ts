// env.ts — lazy env reader for Supabase credentials
// IMPORTANT: Never access env vars at module scope (top-level).
// Only read inside the function so pnpm build succeeds without .env.local

export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local",
    );
  }

  return { url, anonKey };
}
