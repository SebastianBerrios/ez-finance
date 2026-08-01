"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { renameAccount } from "@/modules/accounts/application/rename-account";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";

export interface RenameAccountState {
  error?: string;
  renamed?: string;
}

/**
 * Rename one account.
 *
 * The safest edit in the app: the row keeps its type, its currency, its balance and
 * every transaction, so nothing about any past month changes — only the label. That is
 * why it carries no warning, unlike archiving.
 *
 * ONE ERROR KIND FOR BOTH BAD NAMES. The accounts module's union offers
 * InvalidAccountName and nothing finer, so empty and too-long arrive the same and the
 * message has to cover both. Categories split them; inventing a new kind here to match
 * would make two modules disagree about their own vocabulary for the sake of a nicer
 * sentence.
 */
export async function renameAccountAction(
  _prev: RenameAccountState,
  formData: FormData,
): Promise<RenameAccountState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const name = (formData.get("name") as string | null) ?? "";

  const result = await renameAccount(
    {
      workspaceId: entry.value.workspaceId,
      accountId: ((formData.get("accountId") as string | null) ?? "").trim(),
      name,
    },
    { accounts: new SupabaseAccountAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidAccountName":
        return { error: "Escribe un nombre de hasta 80 caracteres." };
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar las cuentas de este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos renombrar la cuenta. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/cuentas");
  // The dashboard lists balances by account name, and the movement form its picker.
  revalidatePath("/app");

  return { renamed: name.trim() };
}
