"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { settleSplit } from "@/modules/splits/application/settle-split";
import { SupabaseSplitAdapter } from "@/modules/splits/infrastructure/supabase-split-adapter";
import type { SettleState } from "@/modules/splits/ui/components/owed-list";

export async function settleSplitAction(
  _prev: SettleState,
  formData: FormData,
): Promise<SettleState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  /*
    TODAY, not the date of the original expense. A repayment happens when it happens —
    dating it back to the dinner would move money in a month that had already closed,
    and every report of that month would change retroactively.
  */
  const today = new Date().toISOString().slice(0, 10);

  const result = await settleSplit(
    {
      workspaceId: entry.value.workspaceId,
      splitId: (formData.get("splitId") as string | null) ?? "",
      toAccountId: (formData.get("toAccountId") as string | null) ?? "",
      occurredOn: today,
    },
    { splits: new SupabaseSplitAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "AlreadySettled":
        // Two taps on the same button, or the same debt open in two tabs. The list is
        // refreshed so the row that should not have been there disappears.
        revalidatePath("/app/deudas");
        return { error: "Esa deuda ya estaba cobrada." };
      case "AccountRequired":
        return { error: "Elige en qué cuenta entra la plata." };
      case "UnknownReference":
        return { error: "Esa cuenta no es de este espacio." };
      case "NotPermitted":
        return {
          error: "No tienes permiso para registrar cobros en este espacio.",
        };
      default:
        return { error: "No pudimos registrar el cobro. Intenta de nuevo." };
    }
  }

  // Two paths, because the settlement changed two screens: this list loses a row, and
  // the dashboard's balances and "Por cobrar" both moved.
  revalidatePath("/app/deudas");
  revalidatePath("/app");

  return { settled: true };
}
