"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { WORKSPACE_COOKIE } from "@/app/(app)/current-workspace";
import { createWorkspace } from "@/modules/workspaces/application/create-workspace";
import { SupabaseWorkspaceAdapter } from "@/modules/workspaces/infrastructure/supabase-workspace-adapter";

export interface CreateWorkspaceState {
  error?: string;
  created?: string;
}

/**
 * Create a workspace and switch to it.
 *
 * SWITCHING IS PART OF CREATING, not a second step. Someone who just named a space
 * wants to be in it; leaving them on the list looking at a row they have to click is
 * a step that exists only because the code was easier to write that way.
 *
 * No membership check before setting the cookie: the RPC just made the caller its
 * owner, so this is the one moment the id is known-good without asking.
 */
export async function createWorkspaceAction(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const name = (formData.get("name") as string | null) ?? "";

  const result = await createWorkspace(
    { name },
    { workspaces: new SupabaseWorkspaceAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NameRequired":
        return { error: "Escribe un nombre para el espacio." };
      case "NameTooLong":
        return {
          error: "El nombre es demasiado largo (máximo 80 caracteres).",
        };
      case "LimitReached":
        return {
          error:
            "Llegaste al máximo de espacios propios. Archiva alguno antes de crear otro.",
        };
      case "NotPermitted":
        return { error: "Sesión expirada. Por favor ingresa de nuevo." };
      default:
        return { error: "No pudimos crear el espacio. Intenta de nuevo." };
    }
  }

  const store = await cookies();
  store.set(WORKSPACE_COOKIE, result.value.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");

  return { created: name.trim() };
}
