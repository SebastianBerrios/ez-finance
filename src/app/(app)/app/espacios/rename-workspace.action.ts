"use server";

import { renameWorkspace } from "@/modules/workspaces/application/workspace-lifecycle";
import { SupabaseWorkspaceAdapter } from "@/modules/workspaces/infrastructure/supabase-workspace-adapter";
import type { RenameState } from "@shared/ui/rename-inline";

import { workspaceErrorMessage } from "./workspace-error-message";

/**
 * Rename a workspace.
 *
 * The workspace id comes from the form and is NOT trusted: the RPC resolves it
 * against the caller's own memberships and roles, and answers not_permitted for
 * anything else — including a workspace that does not exist, so ids cannot be
 * probed. There is deliberately no membership check here duplicating that.
 */
export async function renameWorkspaceAction(
  _prev: RenameState,
  formData: FormData,
): Promise<RenameState> {
  const name = ((formData.get("name") as string | null) ?? "").trim();

  const result = await renameWorkspace(
    {
      workspaceId: (formData.get("workspaceId") as string | null) ?? "",
      name,
    },
    { workspaces: new SupabaseWorkspaceAdapter() },
  );

  if (!result.ok) return { error: workspaceErrorMessage(result.error) };

  return { renamed: name };
}
