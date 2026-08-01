"use server";

import { revalidatePath } from "next/cache";

import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";

export interface ArchiveAccountState {
  error?: string;
  /** Name of the account, and which way it moved, so the page can confirm it. */
  archived?: string;
  restored?: string;
}

/**
 * Archive or restore one account, chosen by the submitted `intent`.
 *
 * ONE action for both directions rather than two files, because everything except a
 * single boolean is shared — the same lookup, the same error copy, the same two paths
 * to revalidate. Two actions would have been two copies of all of it.
 *
 * NEVER a delete, and the reason is stronger here than for categories: an account's
 * transactions ARE the money. Deleting the row would either orphan them or take them
 * with it, and in both cases every balance and every past month silently changes.
 * Archiving only stops it being offered for new movements.
 */
export async function archiveAccountAction(
  _prev: ArchiveAccountState,
  formData: FormData,
): Promise<ArchiveAccountState> {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const id = ((formData.get("accountId") as string | null) ?? "").trim();
  const name = ((formData.get("accountName") as string | null) ?? "").trim();
  const restoring = formData.get("intent") === "restore";

  if (id.length === 0) {
    return { error: "No pudimos identificar la cuenta." };
  }

  const accounts = new SupabaseAccountAdapter();
  const result = restoring
    ? await accounts.unarchive(entry.value.workspaceId, id)
    : await accounts.archive(entry.value.workspaceId, id);

  if (!result.ok) {
    switch (result.error.kind) {
      // Also what a zero-row update reports: RLS filters the row out rather than
      // raising, so "nothing changed" and "not allowed" are the same answer.
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar las cuentas de este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos guardar el cambio. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/cuentas");
  // The dashboard lists balances and the movement form lists accounts to record
  // against; both change when an account leaves or rejoins circulation.
  revalidatePath("/app");

  return restoring ? { restored: name } : { archived: name };
}
