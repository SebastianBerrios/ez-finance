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
  | { readonly kind: "Unavailable" };
