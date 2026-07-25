"use server";

import { redirect } from "next/navigation";

import { logout } from "@/modules/auth/application/logout";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";

export interface LogoutActionState {
  error?: string;
}

export async function logoutAction(): Promise<LogoutActionState> {
  const auth = new SupabaseAuthAdapter();
  const result = await logout({ auth });

  if (!result.ok) {
    // Redirecting anyway would be worse than useless: the session survived, so
    // the middleware bounces the still-authenticated user off /login back to
    // /app and the failure vanishes — leaving someone convinced they signed out
    // of a shared machine when they did not.
    console.error("[app/logout] sign-out failed:", result.error);
    return {
      error:
        "No pudimos cerrar tu sesión. Intentá de nuevo en unos minutos y, si seguís con problemas, cerrá el navegador.",
    };
  }

  // redirect() throws NEXT_REDIRECT — keep it out of try/catch.
  redirect("/login");
}
