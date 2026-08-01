import type { MonthlySnapshot } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";

/**
 * Errors reading a month.
 *
 * DECLARED HERE rather than imported from the budget module, and the shape is
 * deliberately identical to BudgetConfigError so the budget adapter satisfies this
 * port structurally without either module knowing about the other.
 *
 * eslint-plugin-boundaries forbids one module's application layer importing another's,
 * and it is right to: a report that consumed budget's port would break whenever that
 * port changed shape, for a reason having nothing to do with reporting. The delivery
 * layer composes them, which is the same arrangement the movement form uses for its
 * account and category options.
 */
export type ReportSnapshotError =
  | { readonly kind: "InvalidConfig" }
  | { readonly kind: "NotConfigured" }
  | { readonly kind: "NotPermitted" }
  | { readonly kind: "WorkspaceNotFound" }
  | { readonly kind: "Unavailable" };

export interface ReportSnapshotPort {
  /**
   * Everything about one month. `null` when the workspace has no base currency —
   * it has no account, so it cannot have transactions, which is an unfinished space
   * rather than an error.
   */
  readForMonth(
    workspaceId: string,
    month: Date,
  ): Promise<Result<MonthlySnapshot | null, ReportSnapshotError>>;
}
