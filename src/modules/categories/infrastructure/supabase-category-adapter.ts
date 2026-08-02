// supabase-category-adapter.ts — implements CategoryPort.
// The only file in the categories module that talks to @supabase/*; every backend
// failure is funnelled through mapPostgresError so no code or constraint name
// escapes.
import type {
  CategoryError,
  CategoryPort,
  CategoryRef,
  CategorySummary,
} from "@/modules/categories/application/ports/category-port";
import type { CategoryDraft } from "@/modules/categories/domain/category-draft";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import type { Bucket } from "@shared/domain/budget-types";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
}

function mapPostgresError(error: PostgresErrorLike): CategoryError {
  switch (error.code) {
    // An RLS refusal — the expected outcome for a member or observer under spec §4.
    case "42501":
      return { kind: "NotPermitted" };
    case "23503":
      return { kind: "WorkspaceNotFound" };
    default:
      return { kind: "Unavailable" };
  }
}

interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly bucket: string | null;
  readonly archived_at: string | null;
}

function toSummary(row: CategoryRow): CategorySummary {
  return {
    id: row.id,
    name: row.name,
    // The column's CHECK constrains this to Bucket; null stays null, which is the
    // engine's documented unbucketed case and must not be coerced.
    bucket: row.bucket === null ? null : (row.bucket as Bucket),
    archived: row.archived_at !== null,
  };
}

export class SupabaseCategoryAdapter implements CategoryPort {
  async create(
    workspaceId: string,
    draft: CategoryDraft,
  ): Promise<Result<CategoryRef, CategoryError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase
        .from("categories")
        .insert({
          workspace_id: workspaceId,
          name: draft.name,
          bucket: draft.bucket,
        })
        .select("id")
        .single();

      if (error) return err(mapPostgresError(error));

      // A successful insert that returned no row would mean the id is unknown while
      // the row exists. Reporting Unavailable is honest; inventing an id is not.
      if (data === null) return err({ kind: "Unavailable" });

      return ok({ id: (data as { id: string }).id });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<readonly CategorySummary[], CategoryError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase
        .from("categories")
        .select("id, name, bucket, archived_at")
        .eq("workspace_id", workspaceId)
        .order("name");

      if (error) return err(mapPostgresError(error));

      return ok(((data ?? []) as CategoryRow[]).map(toSummary));
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async rename(
    workspaceId: string,
    categoryId: string,
    name: string,
  ): Promise<Result<void, CategoryError>> {
    try {
      const supabase = await createServerClient();

      const { error, count } = await supabase
        .from("categories")
        .update({ name: name.trim() }, { count: "exact" })
        .eq("workspace_id", workspaceId)
        .eq("id", categoryId);

      if (error) return err(mapPostgresError(error));

      // ZERO ROWS IS A REFUSAL, not a no-op. RLS filters a forbidden UPDATE out
      // instead of raising, so nothing changes and nothing errors — and reporting
      // success there would tell someone their rename worked when it did not.
      if (count === 0) return err({ kind: "NotPermitted" });

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async unarchiveMany(
    workspaceId: string,
    categoryIds: readonly string[],
  ): Promise<Result<void, CategoryError>> {
    if (categoryIds.length === 0) return ok(undefined);

    try {
      const supabase = await createServerClient();

      const { error } = await supabase
        .from("categories")
        .update({ archived_at: null })
        // Scoped by workspace as well as by id, for the same reason archiveMany is:
        // RLS already blocks another workspace's rows, and leaning on that alone
        // means a future policy change silently widens what this can touch.
        .eq("workspace_id", workspaceId)
        .in("id", [...categoryIds]);

      if (error) return err(mapPostgresError(error));

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async archiveMany(
    workspaceId: string,
    categoryIds: readonly string[],
  ): Promise<Result<void, CategoryError>> {
    // "Keep everything" is a valid answer, and an UPDATE with an empty `in` list
    // is at best a wasted round trip and at worst — if the filter were ever
    // dropped — an unscoped write.
    if (categoryIds.length === 0) return ok(undefined);

    try {
      const supabase = await createServerClient();

      const { error } = await supabase
        .from("categories")
        .update({ archived_at: new Date().toISOString() })
        // Scoped by workspace AS WELL AS by id. RLS already blocks another
        // workspace's rows, but leaning on that alone means a future policy change
        // silently widens what this call can touch.
        .eq("workspace_id", workspaceId)
        .in("id", [...categoryIds]);

      if (error) return err(mapPostgresError(error));

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
