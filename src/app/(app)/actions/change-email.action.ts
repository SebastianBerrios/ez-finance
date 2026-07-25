"use server";

import { changeEmail } from "@/modules/auth/application/change-email";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface ChangeEmailState {
  success?: boolean;
  error?: string;
}

// Non-enumerating: any failure (including "already registered") surfaces as
// a generic message so the caller cannot probe email existence.
const GENERIC_ERROR =
  "No pudimos actualizar tu correo. Verificá el formato e intentá de nuevo.";

export async function changeEmailAction(
  _prev: ChangeEmailState,
  formData: FormData,
): Promise<ChangeEmailState> {
  // server-auth-actions: always verify session server-side first.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sesión expirada. Por favor ingresá de nuevo." };
  }

  const next = (formData.get("email") as string | null) ?? "";

  const auth = new SupabaseAuthAdapter();
  const result = await changeEmail({ next }, { auth });

  if (!result.ok) {
    const kind = result.error.kind;
    if (kind === "InvalidEmail") {
      return { error: "Ingresá un correo electrónico válido." };
    }
    // ConflictOrRejected (already registered) maps to GENERIC — never reveal existence.
    return { error: GENERIC_ERROR };
  }

  return { success: true };
}
