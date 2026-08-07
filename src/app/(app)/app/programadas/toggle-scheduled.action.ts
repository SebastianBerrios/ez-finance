"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseScheduledAdapter } from "@/modules/scheduled/infrastructure/supabase-scheduled-adapter";

export interface ToggleScheduledState {
  error?: string;
  paused?: string;
  resumed?: string;
}

/**
 * Pause or resume, chosen by the submitted intent.
 *
 * PAUSE, NEVER DELETE. A schedule that ran for six months is the explanation for six
 * months of transactions; deleting it removes the answer to "why is this here?" and
 * leaves the rows behind. Resuming does NOT back-fill the pause: the watermark advances
 * every night regardless, so the months you were paused stay empty — which is what
 * pausing meant.
 */
export async function toggleScheduledAction(
  _prev: ToggleScheduledState,
  formData: FormData,
): Promise<ToggleScheduledState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const id = ((formData.get("scheduledId") as string | null) ?? "").trim();
  const name = ((formData.get("scheduledName") as string | null) ?? "").trim();
  const pausing = formData.get("intent") === "pause";

  if (id.length === 0)
    return { error: "No pudimos identificar el movimiento." };

  const result = await new SupabaseScheduledAdapter().setPaused(
    entry.value.workspaceId,
    id,
    pausing,
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NotPermitted":
        return { error: "No tienes permiso para editar esto en este espacio." };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos guardar el cambio. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/programadas");
  revalidatePath("/app");

  return pausing ? { paused: name } : { resumed: name };
}
