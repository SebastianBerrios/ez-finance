import { NAME_MAX } from "@/modules/categories/domain/category-draft";
import type { CategoryError } from "@/modules/categories/domain/category-error";
import { err, type Result } from "@shared/domain/result";

import type { CategoryPort } from "./ports/category-port";

interface RenameCategoryInput {
  readonly workspaceId: string;
  readonly categoryId: string;
  readonly name: string;
}

interface RenameCategoryDeps {
  readonly categories: CategoryPort;
}

/**
 * Change a category's name.
 *
 * REUSES categoryDraft's LIMIT rather than its whole validation, because a rename has
 * no bucket to check — the bucket is immutable, and re-bucketing is archive-and-replace.
 * Importing NAME_MAX keeps the two paths agreeing about what a name may be without
 * pretending a rename is a creation.
 */
export async function renameCategory(
  input: RenameCategoryInput,
  deps: RenameCategoryDeps,
): Promise<Result<void, CategoryError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  // A blank id would produce an UPDATE matching nothing, which the adapter reports as
  // NotPermitted — technically safe, and a confusing way to say "you sent no id".
  if (input.categoryId.trim().length === 0) {
    return err({ kind: "NotPermitted" });
  }

  const name = input.name.trim();

  if (name.length === 0) return err({ kind: "NameRequired" });
  if (name.length > NAME_MAX) return err({ kind: "NameTooLong" });

  return deps.categories.rename(input.workspaceId, input.categoryId, name);
}
