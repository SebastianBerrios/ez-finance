import type { Bucket } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";

/**
 * Errors this port can produce. Closed union of kinds, no message, so no backend
 * text reaches a caller — the same rule the accounts and budget ports follow.
 */
export type CategoryError =
  | { readonly kind: "NotPermitted" }
  | { readonly kind: "WorkspaceNotFound" }
  | { readonly kind: "Unavailable" };

export interface CategorySummary {
  readonly id: string;
  readonly name: string;
  /** null is the engine's "unbucketed" case: counted per category, in no bucket. */
  readonly bucket: Bucket | null;
  readonly archived: boolean;
}

export interface CategoryPort {
  listByWorkspace(
    workspaceId: string,
  ): Promise<Result<readonly CategorySummary[], CategoryError>>;

  /**
   * Archive the given categories. ARCHIVE, never delete: an archived category
   * still counts in the months its transactions live in (the engine reads
   * `archived` and deliberately ignores it when totalling), so a past report does
   * not change because someone tidied up in May.
   *
   * An empty list is a no-op, not an error — "keep everything" is a valid answer
   * to the onboarding step that calls this.
   */
  archiveMany(
    workspaceId: string,
    categoryIds: readonly string[],
  ): Promise<Result<void, CategoryError>>;
}
