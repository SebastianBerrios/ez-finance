import type { CategoryDraft } from "@/modules/categories/domain/category-draft";
import type { CategoryError } from "@/modules/categories/domain/category-error";
import type { Bucket } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";

/**
 * One error vocabulary for the whole module, defined in the domain — the same
 * arrangement accounts uses. The port previously declared its own narrower union;
 * folding them together means a caller handles one type, and the validation kinds
 * a draft can produce sit next to the infrastructure kinds an adapter can.
 *
 * Still a closed union of kinds with no message, so no backend text reaches a
 * caller.
 */
export type { CategoryError };

/** What the caller gets back after a create: enough to reference it, nothing more. */
export interface CategoryRef {
  readonly id: string;
}

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
   * Add a category to a workspace.
   *
   * Takes a validated draft, not raw strings: whether "" is a name is a domain
   * question, and an adapter that had to answer it would be deciding product rules
   * from inside the infrastructure layer.
   *
   * The bucket is NOT nullable here even though the column is — see the note in
   * categoryDraft for why setup must not be able to create an unbucketed category.
   */
  create(
    workspaceId: string,
    draft: CategoryDraft,
  ): Promise<Result<CategoryRef, CategoryError>>;

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

  /**
   * Clear `archived_at`, putting the given categories back in circulation.
   *
   * The counterpart archiving needed from the start. Without it, archiving was a
   * ONE-WAY door in a screen whose whole point is that you can change your mind —
   * and the operation it undoes is the one people reach for by accident, because it
   * sits next to every row.
   *
   * Restoring is NOT the inverse of a delete: the row never left, and the months it
   * already counted in never stopped counting it. What changes is only whether it is
   * offered for new movements again.
   *
   * An empty list is a no-op, matching archiveMany.
   */
  unarchiveMany(
    workspaceId: string,
    categoryIds: readonly string[],
  ): Promise<Result<void, CategoryError>>;

  /**
   * Change a category's NAME, and only its name.
   *
   * The bucket is deliberately NOT changeable through this path. It is immutable by
   * design — re-bucketing is archive-and-replace, so the months already lived keep the
   * bucket they were lived under — and a method that took both would be an open
   * invitation to break that.
   */
  rename(
    workspaceId: string,
    categoryId: string,
    name: string,
  ): Promise<Result<void, CategoryError>>;
}
