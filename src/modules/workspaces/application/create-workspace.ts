import { workspaceDraft } from "@/modules/workspaces/domain/workspace-draft";
import type { WorkspaceError } from "@/modules/workspaces/domain/workspace-error";
import { err, type Result } from "@shared/domain/result";

import type { WorkspacePort, WorkspaceRef } from "./ports/workspace-port";

interface CreateWorkspaceInput {
  readonly name: string;
}

interface CreateWorkspaceDeps {
  readonly workspaces: WorkspacePort;
}

/**
 * Create a workspace owned by the caller.
 *
 * NO workspaceId INPUT, and no user id either — both come from the session on the
 * server side. This use case exists mainly to put the name rules in front of the RPC,
 * mirroring createAccount and createCategory: a bad name should not cost a round trip,
 * and the RPC signals it as a Postgres exception the adapter would otherwise have to
 * reverse-engineer.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  deps: CreateWorkspaceDeps,
): Promise<Result<WorkspaceRef, WorkspaceError>> {
  const draft = workspaceDraft({ name: input.name });

  if (!draft.ok) return err(draft.error);

  return deps.workspaces.create(draft.value);
}
