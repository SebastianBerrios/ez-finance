/** Closed union of kinds, no message — the rule every module here follows. */
export type ScheduledError =
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NameTooLong" }
  | { readonly kind: "AmountNotPositive" }
  | { readonly kind: "AccountRequired" }
  | { readonly kind: "InvalidKind" }
  | { readonly kind: "InvalidDay" }
  | { readonly kind: "NoteTooLong" }
  /** Raised by the trigger, not by RLS — see the migration's note. */
  | { readonly kind: "RefNotInWorkspace" }
  | { readonly kind: "NotPermitted" }
  | { readonly kind: "WorkspaceNotFound" }
  | { readonly kind: "Unavailable" };
