"use server";

import { revalidatePath } from "next/cache";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { createCategory } from "@/modules/categories/application/create-category";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";

export interface CreateCategoryState {
  error?: string;
  created?: string;
}

/**
 * Add a category from the management screen.
 *
 * A SECOND action rather than reusing the onboarding one, because they differ in
 * exactly one respect that matters: which paths get revalidated. Sharing it would
 * have meant either revalidating routes the caller is not on, or passing the route
 * in as an argument — a server action taking its own cache key from the client.
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

  revalidatePath("/app/categorias");
  // The dashboard's buckets and the movement form's picker both read categories.
  revalidatePath("/app");

  return { created: name.trim() };
}
