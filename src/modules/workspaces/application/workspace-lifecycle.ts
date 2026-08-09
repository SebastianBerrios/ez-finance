// workspace-lifecycle.ts — rename, archive, unarchive and delete.
//
// FOUR TRANSITIONS IN ONE FILE, deliberately, where the rest of this codebase puts
// one use case per file. They are not four independent operations: they are the
// transitions of ONE state machine over one row, and the machine is what has to be
// read as a whole —
//
//     active ──rename──▶ active
//     active ──archive──▶ archived ──unarchive──▶ active
//                         archived ──delete(exact name)──▶ deleted
//
// Every rule here is about a transition being available or not: you cannot rename
// what is archived, cannot delete what is not archived, cannot archive twice, and
// cannot do either to the personal anchor. Split across four files, the file you
// happen to open tells you a quarter of that.
//
// WHERE THE RULES ACTUALLY LIVE. In the database (20260807210000), as SECURITY
// DEFINER RPCs. mvp-lab shares one auth.users pool across the fleet, so the
// workspace tables accept no direct writes at all. These functions exist for the
// same reason createWorkspace does: to put the cheap checks in front of a round
// trip and to keep Postgres wording out of the delivery layer.
import { workspaceDraft } from "@/modules/workspaces/domain/workspace-draft";
import type { WorkspaceError } from "@/modules/workspaces/domain/workspace-error";
import { err, type Result } from "@shared/domain/result";

import type { WorkspacePort } from "./ports/workspace-port";

interface WorkspaceLifecycleDeps {
  readonly workspaces: WorkspacePort;
}

/**
 * A blank id is not a workspace.
 *
 * A predicate rather than a function returning a Result, because a shared
 * "returns the error or null" helper cannot be typed for four callers with
 * different success types without a cast, and a cast to save three characters per
 * call site is a bad trade. The refusal itself is NotPermitted: from the caller's
 * side an id that names nothing and an id that is not theirs are the same answer,
 * and the RPC deliberately conflates them too so workspace ids cannot be probed.
 */
function isBlank(workspaceId: string): boolean {
  return workspaceId.trim().length === 0;
}

export async function renameWorkspace(
  input: { readonly workspaceId: string; readonly name: string },
  deps: WorkspaceLifecycleDeps,
): Promise<Result<void, WorkspaceError>> {
  if (isBlank(input.workspaceId)) return err({ kind: "NotPermitted" });

  // The SAME validator createWorkspace uses. A renamed workspace is not allowed a
  // name a new one could not have, and two validators would drift.
  const draft = workspaceDraft({ name: input.name });
  if (!draft.ok) return err(draft.error);

  return deps.workspaces.rename(input.workspaceId, draft.value);
}

export async function archiveWorkspace(
  input: { readonly workspaceId: string },
  deps: WorkspaceLifecycleDeps,
): Promise<Result<void, WorkspaceError>> {
  if (isBlank(input.workspaceId)) return err({ kind: "NotPermitted" });

  return deps.workspaces.archive(input.workspaceId);
}

export async function unarchiveWorkspace(
  input: { readonly workspaceId: string },
  deps: WorkspaceLifecycleDeps,
): Promise<Result<void, WorkspaceError>> {
  if (isBlank(input.workspaceId)) return err({ kind: "NotPermitted" });

  return deps.workspaces.unarchive(input.workspaceId);
}

export async function deleteWorkspace(
  input: { readonly workspaceId: string; readonly confirmName: string },
  deps: WorkspaceLifecycleDeps,
): Promise<Result<void, WorkspaceError>> {
  if (isBlank(input.workspaceId)) return err({ kind: "NotPermitted" });

  const confirmName = input.confirmName.trim();

  // An EMPTY box is not a wrong name, and answering "ese nombre no coincide" to
  // someone who typed nothing is answering a question they did not ask. The RPC
  // would refuse it identically; this only makes the message honest.
  if (confirmName.length === 0) return err({ kind: "NameMismatch" });

  // Trimmed on the way out because the stored name is btrimmed at write time and
  // the RPC compares after btrim on both sides. An invisible trailing space must
  // not be why someone cannot end their own workspace.
  return deps.workspaces.delete(input.workspaceId, confirmName);
}
