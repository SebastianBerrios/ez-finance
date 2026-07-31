/**
 * Errors the transactions domain and its port produce.
 *
 * A closed union of kinds with no message, like every other port here, so no
 * Postgres text reaches a caller. The delivery layer picks copy from the kind.
 */
export type TransactionError =
  | { readonly kind: "InvalidKind" }
  | { readonly kind: "InvalidAmount" }
  | { readonly kind: "InvalidDate" }
  | { readonly kind: "AccountRequired" }
  | { readonly kind: "NoteTooLong" }
  /** The account or category does not belong to this workspace. */
  | { readonly kind: "UnknownReference" }
  /** An observer, or someone editing a movement that is not theirs (spec §4). */
  | { readonly kind: "NotPermitted" }
  /** The workspace has no base currency yet, so an amount has nothing to mean. */
  | { readonly kind: "WorkspaceNotReady" }
  | { readonly kind: "Unavailable" };
