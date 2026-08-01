// workspace-draft.ts — pure domain: validate a workspace name before the RPC sees it.
//
// The rules mirror ez_finance.create_workspace() exactly: btrim, non-empty, at most
// 80 characters. Duplicating them here is not belt-and-braces — the RPC raises
// `name_required` and `name_too_long` as Postgres exceptions, and turning those back
// into a sentence a person can act on is work the adapter should not have to do for a
// mistake catchable before the round trip.

import type { Result } from "@shared/domain/result";
import { err, ok } from "@shared/domain/result";

import type { WorkspaceError } from "./workspace-error";

/** Matches the RPC's own `length(v_name) > 80`, measured on the trimmed name. */
export const NAME_MAX = 80;

export interface WorkspaceDraft {
  readonly name: string;
}

export interface WorkspaceDraftInput {
  readonly name: string;
}

export function workspaceDraft(
  input: WorkspaceDraftInput,
): Result<WorkspaceDraft, WorkspaceError> {
  const name = input.name.trim();

  if (name.length === 0) return err({ kind: "NameRequired" });
  if (name.length > NAME_MAX) return err({ kind: "NameTooLong" });

  return ok(Object.freeze({ name }));
}
