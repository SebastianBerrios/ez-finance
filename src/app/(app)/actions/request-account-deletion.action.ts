"use server";

import { redirect } from "next/navigation";

import { requestAccountDeletion } from "@/modules/auth/application/request-account-deletion";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";
import { SupabaseDeletionAdapter } from "@/modules/auth/infrastructure/supabase-deletion-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface RequestAccountDeletionState {
  error?: string;
}

// Re-checked server-side: the client-side gate on the submit button is
// ergonomics, and a Server Action is a public endpoint.
const CONFIRMATION_WORD = "ELIMINAR";

const GENERIC_ERROR =
  "No pudimos procesar la solicitud. Intentá de nuevo en unos minutos.";

export async function requestAccountDeletionAction(
  _prev: RequestAccountDeletionState,
  formData: FormData,
): Promise<RequestAccountDeletionState> {
  // server-auth-actions: always verify the session server-side first.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const confirmation = (formData.get("confirm") as string | null) ?? "";
  if (confirmation.trim().toUpperCase() !== CONFIRMATION_WORD) {
    return { error: `Escribí ${CONFIRMATION_WORD} para confirmar.` };
  }

  const deletion = new SupabaseDeletionAdapter();
  const auth = new SupabaseAuthAdapter();

  const result = await requestAccountDeletion(
    { userId: user.id },
    { deletion, auth },
  );

  if (!result.ok) {
    if (result.error.kind === "ConflictOrRejected") {
      return { error: "Ya hay una eliminación programada para esta cuenta." };
    }
    if (result.error.kind === "SessionExpired") {
      return { error: "Sesión expirada. Por favor ingresa de nuevo." };
    }
    return { error: GENERIC_ERROR };
  }

  if (!result.value.signedOut) {
    // The window IS open, but the session survived. Redirecting to /login now
    // would be worse than useless: the middleware bounces an authenticated user
    // off the auth pages back to /app and the notice never renders. Say what
    // happened instead and let the user close the session themselves.
    return {
      error:
        "Programamos la eliminación de tu cuenta, pero no pudimos cerrar tu sesión. Cerrala manualmente desde “Cerrar sesión”.",
    };
  }

  // The session is closed, so there is nothing left to render inside the app.
  // redirect() throws NEXT_REDIRECT — keep it out of try/catch.
  redirect("/login?deletion=requested");
}
