"use server";

import { revalidatePath } from "next/cache";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { createCategory } from "@/modules/categories/application/create-category";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";

export interface CreateCategoryState {
  error?: string;
  /** Set on success so the form can confirm and clear itself. */
  created?: string;
}

/**
 * Add one category from the setup step.
 *
 * revalidatePath rather than redirect: the person stays on the step and the list
 * above re-renders with the new category already checked, so adding three in a row
 * is three keystrokes-and-enter rather than three navigations.
 */
export async function createCategoryAction(
  _prev: CreateCategoryState,
  formData: FormData,
): Promise<CreateCategoryState> {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const name = (formData.get("name") as string | null) ?? "";

  const result = await createCategory(
    {
      workspaceId: entry.value.workspaceId,
      name,
      bucket: (formData.get("bucket") as string | null) ?? "",
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
      case "InvalidBucket":
        return { error: "Elige a qué parte del reparto pertenece." };
      case "NotPermitted":
        return {
          error: "No tienes permiso para crear categorías en este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos crear la categoría. Intenta de nuevo." };
    }
  }

  revalidatePath("/onboarding/categorias");

  return { created: name.trim() };
}
