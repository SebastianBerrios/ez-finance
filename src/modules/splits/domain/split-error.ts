/**
 * Errors the splits domain and its port produce.
 *
 * A closed union of kinds with no message, like every other port here, so no Postgres
 * text reaches a caller. The delivery layer picks copy from the kind.
 */
export type SplitError =
  /** A negative share. Zero is valid — paying for someone else in full is real. */
  | { readonly kind: "InvalidShare" }
  | { readonly kind: "AccountRequired" }
  | { readonly kind: "InvalidDate" }
  /** No one to owe: that is an ordinary expense, and it has its own screen. */
  | { readonly kind: "DebtorsRequired" }
  | { readonly kind: "TooManyDebtors" }
  | { readonly kind: "DebtorNameRequired" }
  | { readonly kind: "DebtorNameTooLong" }
  | { readonly kind: "InvalidDebtorAmount" }
  /** The account or category does not belong to this workspace. */
  | { readonly kind: "UnknownReference" }
  /** An observer, or an archived workspace — both refuse movements. */
  | { readonly kind: "NotPermitted" }
  /** No base currency yet, so the workspace has no account to split from. */
  | { readonly kind: "WorkspaceNotReady" }
  /** Settling something already settled: a stale screen, not a real request. */
  | { readonly kind: "AlreadySettled" }
  | { readonly kind: "Unavailable" };
