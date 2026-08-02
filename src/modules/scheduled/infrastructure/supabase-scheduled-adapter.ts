// supabase-scheduled-adapter.ts — implements ScheduledPort.
import type {
  ScheduledError,
  ScheduledPort,
  ScheduledRef,
  ScheduledSummary,
} from "@/modules/scheduled/application/ports/scheduled-port";
import type { ScheduledDraft } from "@/modules/scheduled/domain/scheduled-draft";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Map a backend failure.
 *
 * Both cross-workspace sentinels collapse into ONE kind. The person chose an account and
 * a category on the same form, and telling them which of the two is foreign would be
 * precision without value — the fix is the same either way, and the wording gets worse
 * for it.
 */
function mapPostgresError(error: PostgresErrorLike): ScheduledError {
  const message = error.message ?? "";

  if (
    message.includes("account_not_in_workspace") ||
    message.includes("category_not_in_workspace")
  ) {
    return { kind: "RefNotInWorkspace" };
  }

  switch (error.code) {
    case "42501":
      return { kind: "NotPermitted" };
    case "23503":
      return { kind: "WorkspaceNotFound" };
    default:
      return { kind: "Unavailable" };
  }
}

interface ScheduledRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly base_amount: number | string;
  readonly day_of_month: number;
  readonly paused_at: string | null;
  readonly materialised_through: string | null;
  readonly accounts: { readonly name: string } | null;
  readonly categories: { readonly name: string } | null;
}

function toBigInt(value: number | string): bigint {
  return BigInt(typeof value === "string" ? value : Math.trunc(value));
}

export class SupabaseScheduledAdapter implements ScheduledPort {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<readonly ScheduledSummary[], ScheduledError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase
        .from("scheduled_transactions")
        .select(
          "id, name, kind, base_amount, day_of_month, paused_at, materialised_through, accounts(name), categories(name)",
        )
        .eq("workspace_id", workspaceId)
        .order("day_of_month");

      if (error) return err(mapPostgresError(error));

      return ok(
        ((data ?? []) as unknown as ScheduledRow[]).map(
          (row): ScheduledSummary => ({
            id: row.id,
            name: row.name,
            kind: row.kind === "income" ? "income" : "expense",
            amountMinorUnits: toBigInt(row.base_amount),
            dayOfMonth: row.day_of_month,
            accountName: row.accounts?.name ?? "",
            categoryName: row.categories?.name ?? null,
            paused: row.paused_at !== null,
            materialisedThrough: row.materialised_through,
          }),
        ),
      );
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async create(
    workspaceId: string,
    draft: ScheduledDraft,
  ): Promise<Result<ScheduledRef, ScheduledError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase
        .from("scheduled_transactions")
        .insert({
          workspace_id: workspaceId,
          account_id: draft.accountId,
          kind: draft.kind,
          base_amount: draft.amountMinorUnits.toString(),
          name: draft.name,
          day_of_month: draft.dayOfMonth,
          ...(draft.categoryId === undefined
            ? {}
            : { category_id: draft.categoryId }),
          ...(draft.note === undefined ? {} : { note: draft.note }),
        })
        .select("id")
        .single();

      if (error) return err(mapPostgresError(error));
      if (data === null) return err({ kind: "Unavailable" });

      return ok({ id: (data as { id: string }).id });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async setPaused(
    workspaceId: string,
    scheduledId: string,
    paused: boolean,
  ): Promise<Result<void, ScheduledError>> {
    try {
      const supabase = await createServerClient();

      const { error, count } = await supabase
        .from("scheduled_transactions")
        .update(
          { paused_at: paused ? new Date().toISOString() : null },
          { count: "exact" },
        )
        .eq("workspace_id", workspaceId)
        .eq("id", scheduledId);

      if (error) return err(mapPostgresError(error));

      // Zero rows is a refusal: RLS filters a forbidden UPDATE out rather than raising.
      if (count === 0) return err({ kind: "NotPermitted" });

      return ok(undefined);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
