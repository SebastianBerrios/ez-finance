"use server";

import { redirect } from "next/navigation";

import { logout } from "@/modules/auth/application/logout";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";

export async function logoutAction(): Promise<void> {
  const auth = new SupabaseAuthAdapter();
  // Best-effort logout — always redirect to /login regardless of result
  await logout({ auth });
  redirect("/login");
}
