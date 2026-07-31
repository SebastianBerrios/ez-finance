"use server";

import { changePassword } from "@/modules/auth/application/change-password";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface ChangePasswordState {
  success?: boolean;
  error?: string;
}

const GENERIC_ERROR =
  "No pudimos actualizar tu contraseña. Verificá los datos e intentá de nuevo.";

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  // server-auth-actions: always verify session server-side first.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
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
      return {
        error: "La contraseña no cumple los requisitos de seguridad.",
      };
    }
    if (kind === "ReauthRequired") {
      return {
        error:
          "Por seguridad, vuelve a ingresar antes de cambiar la contraseña.",
      };
    }
    return { error: GENERIC_ERROR };
  }

  return { success: true };
}
