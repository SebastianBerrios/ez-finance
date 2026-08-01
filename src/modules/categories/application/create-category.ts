import { categoryDraft } from "@/modules/categories/domain/category-draft";
import type { CategoryError } from "@/modules/categories/domain/category-error";
import { err, type Result } from "@shared/domain/result";

import type { CategoryPort, CategoryRef } from "./ports/category-port";

interface CreateCategoryInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly bucket: string;
}

interface CreateCategoryDeps {
  readonly categories: CategoryPort;
}

/**
 * Add a category to a workspace.
 *
 * WHY THIS EXISTS AT ALL. Until now the only categories that could exist were the
 * eleven seeded when a workspace was created — there was no create path anywhere in
 * the product. So anyone who unchecked most of them during setup, or whose workspace
 * predated the seed, was left with buckets that could never fill: an expense with no
 * category totals into no bucket, and the 50/30/20 panel had nothing to show. This
 * closes that.
 *
 * Validation happens HERE, mirroring createAccount: a bad draft should not cost a
 * round trip, and a CHECK violation arrives as an opaque Postgres error the adapter
 * would have to reverse-engineer into a field-specific message.
 */
export async function createCategory(
  input: CreateCategoryInput,
  deps: CreateCategoryDeps,
): Promise<Result<CategoryRef, CategoryError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  const draft = categoryDraft({ name: input.name, bucket: input.bucket });

  if (!draft.ok) {
    return err(draft.error);
  }

  return deps.categories.create(input.workspaceId, draft.value);
}
