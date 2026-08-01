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
}
