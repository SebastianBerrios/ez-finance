"use server";

import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";

export interface KeepCategoriesState {
  error?: string;
}

/**
 * Archive the categories the person did NOT keep.
 *
 * The form sends the ids to KEEP, so what gets archived is everything else. That
 * direction matters: an unchecked checkbox submits nothing, so a form that sent
 * "ids to archive" would silently keep everything if the browser dropped a field,
 * whereas this way the failure mode is "nothing was archived" — the same
 * conservative outcome, arrived at on purpose rather than by accident.
 */
export async function keepCategoriesAction(
  _prev: KeepCategoriesState,
  formData: FormData,
): Promise<KeepCategoriesState> {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const workspaceId = entry.value.workspaceId;
  const categories = new SupabaseCategoryAdapter();

  const listed = await categories.listByWorkspace(workspaceId);
  if (!listed.ok) {
    return { error: "No pudimos leer tus categorías. Intenta de nuevo." };
  }

  const kept = new Set(formData.getAll("keep").map(String));
  const toArchive = listed.value
    .filter((category) => !category.archived && !kept.has(category.id))
    .map((category) => category.id);

  const archived = await categories.archiveMany(workspaceId, toArchive);
  if (!archived.ok) {
    return {
      error:
        archived.error.kind === "NotPermitted"
          ? "No tienes permiso para editar las categorías de este espacio."
          : "No pudimos guardar los cambios. Intenta de nuevo.",
    };
  }

  redirect("/onboarding/ingreso");
}
