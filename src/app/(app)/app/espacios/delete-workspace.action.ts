"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { WORKSPACE_COOKIE } from "@/app/(app)/current-workspace";
import { deleteWorkspace } from "@/modules/workspaces/application/workspace-lifecycle";
import { SupabaseWorkspaceAdapter } from "@/modules/workspaces/infrastructure/supabase-workspace-adapter";
import type { DeleteWorkspaceState } from "@/modules/workspaces/ui/components/workspace-admin";

import { workspaceErrorMessage } from "./workspace-error-message";

/**
 * End a workspace, with the exact name typed back.
 *
 * THE COOKIE HAS TO GO WITH IT. The selection is remembered in a cookie, and the
 * one being deleted may be the selected one. resolveCurrentWorkspace already falls
 * back to the personal anchor when the selection fails its membership check — and
 * that check now excludes deleted workspaces — so nothing breaks if the cookie
 * survives. But it would leave the person pointed at something that no longer
 * exists and silently relocated on the next read; clearing it makes the fallback
 * intentional rather than incidental.
 *
 * The confirmation is checked in the RPC as well. This action does not compare it
 * to anything: the name it would compare against would come from the same form.
 */
export async function deleteWorkspaceAction(
  _prev: DeleteWorkspaceState,
  formData: FormData,
): Promise<DeleteWorkspaceState> {
  const workspaceId = (formData.get("workspaceId") as string | null) ?? "";

  const result = await deleteWorkspace(
    {
      workspaceId,
      confirmName: (formData.get("confirmName") as string | null) ?? "",
    },
    { workspaces: new SupabaseWorkspaceAdapter() },
  );

  if (!result.ok) return { error: workspaceErrorMessage(result.error) };

  const store = await cookies();
  if (store.get(WORKSPACE_COOKIE)?.value?.trim() === workspaceId) {
    store.delete(WORKSPACE_COOKIE);
  }

  revalidatePath("/app");
  revalidatePath("/app/espacios");

  return {};
}
