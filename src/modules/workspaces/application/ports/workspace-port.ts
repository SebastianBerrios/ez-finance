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
  /**
   * Read-only: it keeps its history and its reports, and accepts no new rows.
   *
   * Enforced in the database, not here — the two write helpers exclude archived
   * workspaces, so every policy in the schema refuses at once (20260807210000).
   * This field is what lets the UI say so before someone tries.
   */
  readonly archived: boolean;
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
   * The caller's membership of `workspaceId`, or null when there is none.
   *
   * THE SECURITY-CRITICAL ONE. The current workspace is remembered in a cookie, and a
   * cookie is client-supplied: it must be checked against membership before anything
   * reads with it. RLS would return empty results for a workspace the caller does not
   * belong to rather than leaking, so the failure mode is a confusing blank screen
   * rather than a breach — but "the leak is prevented one layer down" is not a reason
   * to trust the value here.
   *
   * Returns the workspace's `archived` state along with the yes/no because the two
   * are read from the same row and the caller needs both: a selection that is valid
   * but READ-ONLY has to be resolved differently from one that is neither, and a
   * second round trip to learn that would be a second chance to disagree with the
   * first. A DELETED workspace answers null — it is not a place to be.
   */
  findMembership(
    workspaceId: string,
  ): Promise<Result<{ readonly archived: boolean } | null, WorkspaceError>>;

  /**
   * Rename a workspace. Owner or admin (spec §4 puts configuration in the admin
   * row); refused while archived, because a name is configuration and archived
   * means read-only.
   */
  rename(
    workspaceId: string,
    draft: WorkspaceDraft,
  ): Promise<Result<void, WorkspaceError>>;

  /**
   * Make a workspace read-only, preserving its history (spec §5.2). Owner only.
   *
   * Answers PersonalWorkspace for the bootstrap anchor and AlreadyArchived for a
   * second press on a stale screen.
   */
  archive(workspaceId: string): Promise<Result<void, WorkspaceError>>;

  /** The way back. Owner only; NotArchived when there is nothing to undo. */
  unarchive(workspaceId: string): Promise<Result<void, WorkspaceError>>;

  /**
   * End a workspace. Owner only, archived first, and the EXACT name typed back
   * (spec §5.2).
   *
   * `confirmName` is checked by the RPC rather than by the form. A confirmation
   * that lives only in the UI is one a replayed request does not perform, and this
   * is the single button in the app that ends a workspace.
   */
  delete(
    workspaceId: string,
    confirmName: string,
  ): Promise<Result<void, WorkspaceError>>;
}
