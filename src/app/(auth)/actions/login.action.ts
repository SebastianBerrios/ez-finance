"use server";

import { redirect } from "next/navigation";

import { login } from "@/modules/auth/application/login";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";

export interface LoginState {
  error?: string;
}

// Generic error shown for ALL login failures — never reveals if email exists,
// is unconfirmed, or belongs to a Google account (C1 decision, locked #128 / JD #142).
const GENERIC_LOGIN_ERROR = "Correo o contraseña incorrectos.";

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = (formData.get("email") as string | null) ?? "";
  const password = (formData.get("password") as string | null) ?? "";

  const auth = new SupabaseAuthAdapter();
  const result = await login({ email, password }, { auth });

  if (!result.ok) {
    // ALL login failures map to the same generic message — no enumeration.
    return { error: GENERIC_LOGIN_ERROR };
  }

  redirect("/app");
}
