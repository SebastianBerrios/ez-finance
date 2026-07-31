/**
 * Errors the budget-config port and its use cases can produce.
 *
 * Separate from ConfigError in shared/domain/budget-types: that one describes a
 * mathematically invalid config (percentages not summing to 100, and so on) and is
 * produced by the pure engine. This one describes a failure to STORE or READ one,
 * which the engine has no notion of.
 *
 * A closed union of kinds with no message, like the rest of the app's ports, so no
 * backend text reaches a caller.
 */
export type BudgetConfigError =
  /** The percentages or income are not a config the engine would accept. */
  | { readonly kind: "InvalidConfig" }
  /**
   * The workspace has no account or no budget config, so there is nothing to
   * compute. Distinct from InvalidConfig: nothing is wrong, setup is unfinished —
   * and the caller's answer is to send the person to the wizard, not to show an
   * error.
   */
  | { readonly kind: "NotConfigured" }
  /** Only owner and admin manage the budget (spec §4). */
  | { readonly kind: "NotPermitted" }
  /** No workspace, or not one the caller belongs to. */
  | { readonly kind: "WorkspaceNotFound" }
  | { readonly kind: "Unavailable" };
