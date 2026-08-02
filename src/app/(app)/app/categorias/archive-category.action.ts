"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";

export interface ArchiveCategoryState {
  error?: string;
  /** Name of the category just archived, so the page can confirm it. */
  archived?: string;
}

/**
 * Archive one category.
 *
 * ARCHIVE, never delete — the port only offers archiving and that is deliberate:
 * an archived category still counts in the months its transactions live in, so a
 * past month does not silently change its numbers because someone tidied up in
 * September. What archiving removes is the option to pick it for NEW movements.
 *
 * There is no un-archive path yet. The DB permits it (`categories_update_manager`)
 * but the port has no method, so this can be reversed only by adding one — worth
 * knowing before archiving something with a long history.
 */
export async function archiveCategoryAction(
  _prev: ArchiveCategoryState,
  formData: FormData,
): Promise<ArchiveCategoryState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const id = ((formData.get("categoryId") as string | null) ?? "").trim();
  const name = ((formData.get("categoryName") as string | null) ?? "").trim();

  if (id.length === 0) {
    return { error: "No pudimos identificar la categoría." };
  }

  const result = await new SupabaseCategoryAdapter().archiveMany(
    entry.value.workspaceId,
    [id],
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NotPermitted":
        return {
          error: "No tienes permiso para archivar categorías en este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos archivar la categoría. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/categorias");
  revalidatePath("/app");

  return { archived: name };
}
