"use server";

import { revalidatePath } from "next/cache";

import { cancelAccountDeletion } from "@/modules/auth/application/cancel-account-deletion";
import { SupabaseDeletionAdapter } from "@/modules/auth/infrastructure/supabase-deletion-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface CancelAccountDeletionState {
  error?: string;
}

const GENERIC_ERROR =
  "No pudimos cancelar la eliminación. Intentá de nuevo en unos minutos.";

export async function cancelAccountDeletionAction(
  _prev: CancelAccountDeletionState,
  _formData: FormData,
): Promise<CancelAccountDeletionState> {
  // server-auth-actions: always verify the session server-side first.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const deletion = new SupabaseDeletionAdapter();
  const result = await cancelAccountDeletion({ userId: user.id }, { deletion });

  if (!result.ok) {
    if (result.error.kind === "ConflictOrRejected") {
      // Nothing pending, or the window already closed — the page re-render
      // shows the real current state.
      return {
        error:
          "Ya no se puede cancelar: el plazo venció o no hay una eliminación pendiente.",
      };
    }
    if (result.error.kind === "SessionExpired") {
      return { error: "Sesión expirada. Por favor ingresa de nuevo." };
    }
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/app/settings/account");
  return {};
}
