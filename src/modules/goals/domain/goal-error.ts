/**
 * Errors the goals domain and its port can produce.
 *
 * Closed union of kinds with no message, like every other module here.
 */
export type GoalError =
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NameTooLong" }
  /** Zero or negative. A goal of zero is reached the moment it exists. */
  | { readonly kind: "TargetNotPositive" }
  /** No account means no progress: the account's balance IS the progress. */
  | { readonly kind: "AccountRequired" }
  | { readonly kind: "InvalidDate" }
  /**
   * The chosen account belongs to a different workspace. Raised by the database
   * trigger, not by RLS — someone with two spaces can see both spaces' accounts, so
   * this is the only thing standing between a goal and money its space does not have.
   */
  | { readonly kind: "AccountNotInWorkspace" }
  | { readonly kind: "NotPermitted" }
  | { readonly kind: "WorkspaceNotFound" }
  | { readonly kind: "Unavailable" };
