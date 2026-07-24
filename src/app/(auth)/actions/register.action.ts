"use server";

import { redirect } from "next/navigation";

import { register } from "@/modules/auth/application/register";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";

export interface RegisterState {
  error?: string;
  success?: boolean;
}

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const email = (formData.get("email") as string | null) ?? "";
  const password = (formData.get("password") as string | null) ?? "";

  const auth = new SupabaseAuthAdapter();
  const result = await register({ email, password }, { auth });

  if (!result.ok) {
    const { kind } = result.error;
    if (kind === "InvalidEmail") {
      return { error: "El formato del correo no es válido." };
    }
    if (kind === "WeakPassword") {
      return {
        error:
          "La contraseña no cumple los requisitos (mínimo 10 caracteres, letra y número).",
      };
    }
    // Any other error (rate limited, unavailable, etc.) — generic
    return {
      error: "No pudimos completar el registro. Intenta de nuevo más tarde.",
    };
  }

  // Non-enumerating: always redirect to check-email, same message whether new or existing.
  redirect("/check-email?from=register");
}
