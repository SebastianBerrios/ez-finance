// supabase-workspace-adapter.ts — implements WorkspacePort.
// The only file in the workspaces module that talks to @supabase/*.
import type {
  WorkspaceError,
  WorkspacePort,
  WorkspaceRef,
  WorkspaceRole,
  WorkspaceSummary,
} from "@/modules/workspaces/application/ports/workspace-port";
import type { WorkspaceDraft } from "@/modules/workspaces/domain/workspace-draft";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Map a failure from the RPC.
 *
 * THE MESSAGE IS READ HERE AND NOWHERE ELSE. create_workspace() signals its three
 * refusals by RAISE, and PostgREST returns them as a message string — so this is the
 * one place that has to look at backend text. It is matched against the exact
 * sentinels the function raises and immediately discarded: the WorkspaceError union
 * carries kinds only, so nothing beyond this function ever sees Postgres wording.
 *
 * Anything unrecognised becomes Unavailable rather than being guessed at.
 */
function mapRpcError(error: PostgresErrorLike): WorkspaceError {
  const message = error.message ?? "";

  if (message.includes("name_required")) return { kind: "NameRequired" };
  if (message.includes("name_too_long")) return { kind: "NameTooLong" };
  if (message.includes("workspace_limit_reached")) {
    return { kind: "LimitReached" };
  }
  // session_not_found, or the grant refusing an unprivileged caller.
  if (message.includes("session_not_found") || error.code === "42501") {
    return { kind: "NotPermitted" };
  }

  return { kind: "Unavailable" };
}

interface MembershipRow {
  readonly role: string;
  readonly workspaces: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
  } | null;
}

export class SupabaseWorkspaceAdapter implements WorkspacePort {
  async listForCurrentUser(): Promise<
    Result<readonly WorkspaceSummary[], WorkspaceError>
  > {
    try {
      const supabase = await createServerClient();

      // Read from workspace_members and join outward, not the other way round: the
      // caller's ROLE lives on the membership, and it is what the UI gates on.
      // RLS scopes this to their own rows, so there is no user id to pass.
      const { data, error } = await supabase
        .from("workspace_members")
        .select("role, workspaces!inner(id, name, type, deleted_at)")
        .is("workspaces.deleted_at", null);

      if (error) return err(mapRpcError(error));

      const rows = (data ?? []) as unknown as MembershipRow[];

      return ok(
        rows
          .filter((row) => row.workspaces !== null)
          .map((row): WorkspaceSummary => ({
            id: row.workspaces!.id,
            name: row.workspaces!.name,
            // Narrowed rather than cast: the column's CHECK allows only these two,
            // and anything else is a row no app path could have written.
            type: row.workspaces!.type === "personal" ? "personal" : "shared",
            role: row.role as WorkspaceRole,
          }))
          // Personal first, then alphabetical: the home space is the one people look
          // for, and after that any order is arbitrary so it may as well be stable.
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === "personal" ? -1 : 1;
            return a.name.localeCompare(b.name, "es");
          }),
      );
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async create(
    draft: WorkspaceDraft,
  ): Promise<Result<WorkspaceRef, WorkspaceError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase.rpc("create_workspace", {
        p_name: draft.name,
      });

      if (error) return err(mapRpcError(error));

      if (typeof data !== "string" || data.length === 0) {
        // The RPC returns the new id. No id and no error would mean the row exists
        // and we cannot name it; reporting Unavailable is honest, inventing one is not.
        return err({ kind: "Unavailable" });
      }

      return ok({ id: data });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async isMember(
    workspaceId: string,
  ): Promise<Result<boolean, WorkspaceError>> {
    if (workspaceId.trim().length === 0) return ok(false);

    try {
      const supabase = await createServerClient();

      // `head` + exact count: this asks a yes/no question, and pulling the row back
      // to answer it would invite someone to start using the row.
      const { count, error } = await supabase
        .from("workspace_members")
        .select("workspace_id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);

      if (error) return err(mapRpcError(error));

      return ok((count ?? 0) > 0);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
