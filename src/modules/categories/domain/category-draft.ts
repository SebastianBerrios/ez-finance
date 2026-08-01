// category-draft.ts — pure domain: validate a category before it reaches the DB.
//
// The rules here mirror the column constraints exactly, on purpose. The database
// is the authority (`name text not null check (length(btrim(name)) between 1 and
// 60)`, `bucket in ('need','want','save')`), and duplicating them here is not
// belt-and-braces — it is what turns a 23514 constraint violation into a sentence
// a person can act on.

import type { Bucket } from "@shared/domain/budget-types";
import type { Result } from "@shared/domain/result";
import { err, ok } from "@shared/domain/result";

import type { CategoryError } from "./category-error";

/**
 * Matches the column's own `between 1 and 60`, measured on the TRIMMED name —
 * which is what gets stored, so it is what the limit must apply to.
 */
export const NAME_MAX = 60;

const BUCKETS: readonly string[] = ["need", "want", "save"];

export interface CategoryDraft {
  readonly name: string;
  readonly bucket: Bucket;
}

export interface CategoryDraftInput {
  readonly name: string;
  readonly bucket: string;
}

/**
 * Validate a new category.
 *
 * The bucket is REQUIRED here even though the column is nullable. An unbucketed
 * category is a real state the engine tolerates — its spending totals but lands in
 * no bucket — and that is exactly why setup must not be able to produce one by
 * accident: money would leave an account and appear in none of the three cubes,
 * which reads as the app losing it.
 *
 * Errors are reported in a FIXED order, name before bucket, so someone fixing two
 * faults is told about the same one twice rather than being sent in a circle.
 */
export function categoryDraft(
  input: CategoryDraftInput,
): Result<CategoryDraft, CategoryError> {
  const name = input.name.trim();

  if (name.length === 0) {
    return err({ kind: "NameRequired" });
  }

  if (name.length > NAME_MAX) {
    return err({ kind: "NameTooLong" });
  }

  if (!BUCKETS.includes(input.bucket)) {
    return err({ kind: "InvalidBucket" });
  }

  return ok(Object.freeze({ name, bucket: input.bucket as Bucket }));
}
