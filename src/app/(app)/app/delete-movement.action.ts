"use server";

import { revalidatePath } from "next/cache";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { deleteMovement } from "@/modules/transactions/application/delete-movement";
import { SupabaseTransactionAdapter } from "@/modules/transactions/infrastructure/supabase-transaction-adapter";

export interface DeleteMovementState {
  error?: string;
}

export async function deleteMovementAction(
  _prev: DeleteMovementState,
  formData: FormData,
): Promise<DeleteMovementState> {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const transferIdRaw = (formData.get("transferId") as string | null) ?? "";

  const result = await deleteMovement(
    {
      workspaceId: entry.value.workspaceId,
      transactionId: (formData.get("transactionId") as string | null) ?? "",
      // An empty field means "not a transfer" — the form omits nothing, so the
      // distinction has to be made here rather than by absence.
      transferId: transferIdRaw.length === 0 ? null : transferIdRaw,
    },
    { transactions: new SupabaseTransactionAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NotPermitted":
        return {
          error: "Solo puedes eliminar los movimientos que registraste tú.",
        };
      case "UnknownReference":
        return { error: "Ese movimiento ya no existe." };
      default:
        return { error: "No pudimos eliminarlo. Intenta de nuevo." };
    }
  }

  // No redirect: the person stays where they were. The dashboard is
  // force-dynamic, but a Server Action's own response is not — without this the
  // deleted row lingers on screen until the next full navigation.
  revalidatePath("/app");

  return {};
}
