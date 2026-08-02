"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseGoalAdapter } from "@/modules/goals/infrastructure/supabase-goal-adapter";

export interface ArchiveGoalState {
  error?: string;
  archived?: string;
}

/**
 * Archive a goal.
 *
 * NEVER a delete, and never a withdrawal: archiving a goal changes nothing about the
 * account behind it. The money stays exactly where it is, which is what the
 * confirmation says — because "archive" next to a savings target reads, reasonably, as
 * if something might happen to the savings.
 */
export async function archiveGoalAction(
  _prev: ArchiveGoalState,
  formData: FormData,
): Promise<ArchiveGoalState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const id = ((formData.get("goalId") as string | null) ?? "").trim();
  const name = ((formData.get("goalName") as string | null) ?? "").trim();

  if (id.length === 0) return { error: "No pudimos identificar la meta." };

  const result = await new SupabaseGoalAdapter().archive(
    entry.value.workspaceId,
    id,
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar las metas de este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos archivar la meta. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/metas");
  revalidatePath("/app");

  return { archived: name };
}
