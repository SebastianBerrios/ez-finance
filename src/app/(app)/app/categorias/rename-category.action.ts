"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { renameCategory } from "@/modules/categories/application/rename-category";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";

export interface RenameCategoryState {
  error?: string;
  renamed?: string;
}

/**
 * Rename one category.
 *
 * Renaming is the one edit that changes NOTHING about history: the same row keeps the
 * same bucket and the same transactions, so every past month reports exactly what it
 * did before, under a different label. That is why it needs no warning, unlike
 * archiving — and why the bucket is not editable here.
 */
export async function renameCategoryAction(
  _prev: RenameCategoryState,
  formData: FormData,
): Promise<RenameCategoryState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const name = (formData.get("name") as string | null) ?? "";

  const result = await renameCategory(
    {
      workspaceId: entry.value.workspaceId,
      categoryId: ((formData.get("categoryId") as string | null) ?? "").trim(),
      name,
    },
    { categories: new SupabaseCategoryAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NameRequired":
        return { error: "Escribe un nombre para la categoría." };
      case "NameTooLong":
        return {
          error: "El nombre es demasiado largo (máximo 60 caracteres).",
        };
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar categorías en este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return {
          error: "No pudimos renombrar la categoría. Intenta de nuevo.",
        };
    }
  }

  revalidatePath("/app/categorias");
  // The dashboard's movement list and the report both label by category name.
  revalidatePath("/app");
  revalidatePath("/app/reportes");

  return { renamed: name.trim() };
}
