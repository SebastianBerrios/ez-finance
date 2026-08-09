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
  // The lifecycle sentinels (20260807210000). Order matters against `includes`:
  // 'already_archived' and 'not_archived' both contain 'archived', so the specific
  // ones are tested before the generic 'workspace_archived'.
  if (message.includes("already_archived")) return { kind: "AlreadyArchived" };
  if (message.includes("not_archived")) return { kind: "NotArchived" };
  if (message.includes("workspace_archived")) return { kind: "Archived" };
  if (message.includes("personal_workspace")) {
    return { kind: "PersonalWorkspace" };
  }
  if (message.includes("name_mismatch")) return { kind: "NameMismatch" };
  if (message.includes("not_permitted")) return { kind: "NotPermitted" };
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
    readonly archived_at: string | null;
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
        .select(
          "role, workspaces!inner(id, name, type, archived_at, deleted_at)",
        )
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
            archived: row.workspaces!.archived_at !== null,
          }))
          // Personal first, then ACTIVE before archived, then alphabetical. The home
          // space is the one people look for; after that, a read-only space is not
          // what someone scanning the list is trying to switch to, so it sinks
          // instead of being interleaved.
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === "personal" ? -1 : 1;
            if (a.archived !== b.archived) return a.archived ? 1 : -1;
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

  async findMembership(
    workspaceId: string,
  ): Promise<Result<{ readonly archived: boolean } | null, WorkspaceError>> {
    if (workspaceId.trim().length === 0) return ok(null);

    try {
      const supabase = await createServerClient();

      // JOINED TO WORKSPACES so a DELETED one answers null. The membership rows
      // survive a soft delete — deleted_at is on the workspace, not on them — so
      // without this filter the cookie of a workspace someone just deleted would
      // still resolve as the current space, and they would land on a dashboard for
      // something they ended.
      //
      // An ARCHIVED one answers yes, with archived: true. It is read-only, not
      // gone, and its reports are the whole reason to keep it.
      //
      // maybeSingle, not single: "no such membership" is an ANSWER here, and single
      // would turn it into an error the caller would read as "we could not look".
      const { data, error } = await supabase
        .from("workspace_members")
        .select("workspace_id, workspaces!inner(archived_at, deleted_at)")
        .eq("workspace_id", workspaceId)
        .is("workspaces.deleted_at", null)
        .limit(1)
        .maybeSingle();

      if (error) return err(mapRpcError(error));
      if (!data) return ok(null);

      const row = data as unknown as {
        workspaces: { archived_at: string | null } | null;
      };

      // `?? null` and not `?.archived_at !== null`, which would read a FAILED embed
      // (workspaces === undefined) as archived and put a read-only banner on a
      // healthy space. A missing embed means we do not know, and the database is
      // the authority on writes anyway — so the honest default is "not archived",
      // where an attempted write gets refused for the real reason.
      const archivedAt = row.workspaces?.archived_at ?? null;

      return ok({ archived: archivedAt !== null });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async rename(
    workspaceId: string,
    draft: WorkspaceDraft,
  ): Promise<Result<void, WorkspaceError>> {
    return this.callVoidRpc("rename_workspace", {
      p_workspace_id: workspaceId,
      p_name: draft.name,
    });
  }

  async archive(workspaceId: string): Promise<Result<void, WorkspaceError>> {
    return this.callVoidRpc("archive_workspace", {
      p_workspace_id: workspaceId,
    });
  }

  async unarchive(workspaceId: string): Promise<Result<void, WorkspaceError>> {
    return this.callVoidRpc("unarchive_workspace", {
      p_workspace_id: workspaceId,
    });
  }

  async delete(
    workspaceId: string,
    confirmName: string,
  ): Promise<Result<void, WorkspaceError>> {
    return this.callVoidRpc("delete_workspace", {
      p_workspace_id: workspaceId,
      p_confirm_name: confirmName,
    });
  }

  /**
   * The four lifecycle RPCs return void, so there is nothing to read but the error.
   *
   * Shared rather than repeated four times: what matters is that a failure is
   * mapped through mapRpcError and never surfaces Postgres wording, and one copy
   * of that is one place for it to be true.
   *
   * NOTE ON `void`: an RPC that raises nothing succeeded. There is no row count to
   * check the way the transactions adapter checks one, because these go through
   * SECURITY DEFINER functions that RAISE on refusal instead of being filtered by
   * a policy — the silent-zero-rows failure mode does not exist here.
   */
  private async callVoidRpc(
    name: string,
    args: Record<string, string>,
  ): Promise<Result<void, WorkspaceError>> {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.rpc(name, args);

      if (error) return err(mapRpcError(error));

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
