"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";

export interface RestoreCategoryState {
  error?: string;
  /** Name of the category just restored, so the page can confirm it. */
  restored?: string;
}

/**
 * Put one archived category back in circulation.
 *
 * The counterpart archiving needed from the start. Without it, the Archivar button
 * was a one-way door on a screen whose whole point is that you can change your mind
 * — and it sits next to every row, which is exactly the shape of a mistake.
 *
 * Restoring is NOT undoing a delete: the row never left, and the months it already
 * counted in never stopped counting it. What comes back is only being offered for
 * NEW movements.
 */
export async function restoreCategoryAction(
  _prev: RestoreCategoryState,
  formData: FormData,
): Promise<RestoreCategoryState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const id = ((formData.get("categoryId") as string | null) ?? "").trim();
  const name = ((formData.get("categoryName") as string | null) ?? "").trim();

  if (id.length === 0) {
    return { error: "No pudimos identificar la categoría." };
  }

  const result = await new SupabaseCategoryAdapter().unarchiveMany(
    entry.value.workspaceId,
    [id],
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar categorías en este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return {
          error: "No pudimos restaurar la categoría. Intenta de nuevo.",
        };
    }
  }

  revalidatePath("/app/categorias");
  revalidatePath("/app");

  return { restored: name };
}
