/**
 * Errors the workspaces domain and its port can produce.
 *
 * Closed union of kinds with no message, the same rule accounts, categories and
 * budget follow: no Postgres text reaches a caller or a UI through this type.
 */
export type WorkspaceError =
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NameTooLong" }
  /**
   * The per-user ceiling on owned workspaces. Surfaced as its own kind rather than
   * folded into Unavailable, because it is the one failure here a person can act on.
   */
  | { readonly kind: "LimitReached" }
  | { readonly kind: "NotPermitted" }
  /** A write was attempted on an archived workspace, which is read-only. */
  | { readonly kind: "Archived" }
  /** Archiving something already archived — a stale screen, not a real request. */
  | { readonly kind: "AlreadyArchived" }
  /**
   * Unarchiving or deleting something that is not archived.
   *
   * Deleting requires archiving first (spec §5.2), so this is the step that was
   * skipped rather than a failure of the delete itself.
   */
  | { readonly kind: "NotArchived" }
  /**
   * The personal workspace, which is neither archivable nor deletable.
   *
   * It is bootstrap()'s anchor: deleting it would make the next sign-in create a
   * second one and present it as home, with the person's history replaced by an
   * empty space that looks correct.
   */
  | { readonly kind: "PersonalWorkspace" }
  /** The typed confirmation did not match the workspace's name. */
  | { readonly kind: "NameMismatch" }
  | { readonly kind: "Unavailable" };
