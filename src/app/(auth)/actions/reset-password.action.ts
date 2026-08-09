"use server";

import { redirect } from "next/navigation";

import { changePassword } from "@/modules/auth/application/change-password";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface ResetPasswordState {
  error?: string;
}

// Password-reset completion action.
// The user arrives here after following a Supabase recovery email link.
// Supabase @supabase/ssr establishes a temporary recovery session from the
// token in the URL (handled by the page via the browser client exchange).
// This action calls updateUser({password}) on the established session.
//
// NOTE: Recovery EMAIL is deferred until Resend SMTP is configured.
// The code path (session exchange + updateUser) is correct and ready.
export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  // server-auth-actions: verify the recovery session is active before writing.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error:
        "El enlace de recuperación expiró o no es válido. Solicitá uno nuevo.",
    };
  }

  const next = (formData.get("password") as string | null) ?? "";
  const confirm = (formData.get("confirmPassword") as string | null) ?? "";

  if (next !== confirm) {
    return { error: "Las contraseñas no coinciden." };
  }

  const auth = new SupabaseAuthAdapter();
  const result = await changePassword({ next }, { auth });

  if (!result.ok) {
    const kind = result.error.kind;
    if (kind === "WeakPassword") {
      return { error: "La contraseña no cumple los requisitos de seguridad." };
    }
    return { error: "No pudimos actualizar tu contraseña. Intentá de nuevo." };
  }

  // On success, redirect to /login with a flag so the page can show a confirmation.
  redirect("/login?reset=ok");
}
