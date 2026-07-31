/**
 * Errors the accounts domain and its port can produce.
 *
 * Deliberately a closed union of KINDS with no message field: the same rule the
 * auth module follows, so no Postgres or Supabase text can reach a caller — or a
 * UI — through this type. Copy for the UI is chosen at the delivery layer from
 * the kind alone.
 */
export type AccountError =
  | { readonly kind: "InvalidAccountName" }
  | { readonly kind: "InvalidAccountType" }
  | { readonly kind: "UnsupportedCurrency" }
  /** The caller is not allowed to manage this workspace's accounts (spec §4). */
  | { readonly kind: "NotPermitted" }
  /** No workspace, or not one the caller belongs to. */
  | { readonly kind: "WorkspaceNotFound" }
  /** Backend unreachable, or any failure we refuse to describe further. */
  | { readonly kind: "Unavailable" };
