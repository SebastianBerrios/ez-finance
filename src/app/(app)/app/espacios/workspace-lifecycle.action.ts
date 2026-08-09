"use server";

import { revalidatePath } from "next/cache";

import {
  archiveWorkspace,
  unarchiveWorkspace,
} from "@/modules/workspaces/application/workspace-lifecycle";
import { SupabaseWorkspaceAdapter } from "@/modules/workspaces/infrastructure/supabase-workspace-adapter";
import type { WorkspaceLifecycleState } from "@/modules/workspaces/ui/components/workspace-admin";

import { workspaceErrorMessage } from "./workspace-error-message";

/**
 * Archive or restore, chosen by the form's `intent`.
 *
 * ONE ACTION FOR BOTH, the same shape the accounts and categories lists already use.
 * The button is one control whose label flips with the row's state, so two actions
 * would mean two useActionState hooks whose pending flags could disagree about
 * whether that one button is busy.
 *
 * An unrecognised intent is a refusal, not a default. Defaulting to archive would
 * make a typo or a replayed request take a workspace read-only.
 */
export async function workspaceLifecycleAction(
  _prev: WorkspaceLifecycleState,
  formData: FormData,
): Promise<WorkspaceLifecycleState> {
  const workspaceId = (formData.get("workspaceId") as string | null) ?? "";
  const workspaceName = (formData.get("workspaceName") as string | null) ?? "";
  const intent = (formData.get("intent") as string | null) ?? "";

  if (intent !== "archive" && intent !== "restore") {
    return { error: "No pudimos completar la acción. Intenta de nuevo." };
  }

  const deps = { workspaces: new SupabaseWorkspaceAdapter() };

  const result =
    intent === "archive"
      ? await archiveWorkspace({ workspaceId }, deps)
      : await unarchiveWorkspace({ workspaceId }, deps);

  if (!result.ok) return { error: workspaceErrorMessage(result.error) };

  // Archiving changes what the REST of the app will accept — every write path now
  // refuses for this workspace — so the dashboard's cached render is stale in a way
  // that matters. Revalidated rather than redirected: the person is mid-list and
  // may want to act on another row.
  revalidatePath("/app");
  revalidatePath("/app/espacios");

  return intent === "archive"
    ? { archived: workspaceName }
    : { restored: workspaceName };
}
