import type { WorkspaceDraft } from "@/modules/workspaces/domain/workspace-draft";
import type { WorkspaceError } from "@/modules/workspaces/domain/workspace-error";
import type { Result } from "@shared/domain/result";

export type { WorkspaceError };

export type WorkspaceRole = "owner" | "admin" | "member" | "observer";

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  /** 'personal' is the one bootstrap() creates and resolves; the rest are 'shared'. */
  readonly type: "personal" | "shared";
  /** The CALLER's role in it, which is what the UI gates on. */
  readonly role: WorkspaceRole;
}

export interface WorkspaceRef {
  readonly id: string;
}

export interface WorkspacePort {
  /**
   * Every workspace the caller belongs to, with their role in each.
   *
   * RLS already restricts this to the caller's own memberships, so there is no user
   * id to pass — asking for one would create a parameter the server would have to
   * distrust.
   */
  listForCurrentUser(): Promise<
    Result<readonly WorkspaceSummary[], WorkspaceError>
  >;

  /**
   * Create a workspace owned by the caller.
   *
   * Goes through the ez_finance.create_workspace RPC rather than an INSERT, because
   * workspaces and workspace_members have no INSERT policy at all — membership must
   * never be self-inserted on a project whose auth pool is shared with every other
   * app. See 20260801120000.
   */
  create(draft: WorkspaceDraft): Promise<Result<WorkspaceRef, WorkspaceError>>;

  /**
   * Whether the caller is a member of `workspaceId`.
   *
   * THE SECURITY-CRITICAL ONE. The current workspace is remembered in a cookie, and a
   * cookie is client-supplied: it must be checked against membership before anything
   * reads with it. RLS would return empty results for a workspace the caller does not
   * belong to rather than leaking, so the failure mode is a confusing blank screen
   * rather than a breach — but "the leak is prevented one layer down" is not a reason
   * to trust the value here.
   */
  isMember(workspaceId: string): Promise<Result<boolean, WorkspaceError>>;
}
