// supabase-account-adapter.ts — implements AccountPort.
// The ONLY file in the accounts module that talks to @supabase/*. Every backend
// error is funnelled through mapPostgresError(); no Postgres code, constraint
// name or message escapes past this file.
import type {
  AccountPort,
  AccountRef,
  AccountSummary,
} from "@/modules/accounts/application/ports/account-port";
import type { AccountDraft } from "@/modules/accounts/domain/account-draft";
import type { AccountError } from "@/modules/accounts/domain/account-error";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import type { AccountType } from "@shared/domain/budget-types";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Translate a PostgREST/Postgres failure into a domain kind.
 *
 * `42501` is what an RLS policy refusal looks like from the client, and it is the
 * expected outcome for a member or observer trying to manage accounts (spec §4) —
 * not an exceptional condition.
 *
 * A CHECK violation (`23514`) means the domain and the table disagree, since
 * accountDraft validates the same rules before we get here. It is reported as
 * Unavailable rather than as a field error, because guessing WHICH field from a
 * constraint name is how a wrong message ends up next to a valid input.
 */
function mapPostgresError(error: PostgresErrorLike): AccountError {
  switch (error.code) {
    case "42501":
      return { kind: "NotPermitted" };
    case "23503":
      return { kind: "WorkspaceNotFound" };
    default:
      return { kind: "Unavailable" };
  }
}

const SUMMARY_COLUMNS = "id, name, type, currency, archived_at";

interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly archived_at: string | null;
}

function toSummary(row: AccountRow): AccountSummary {
  return {
    id: row.id,
    name: row.name,
    // The column's CHECK constrains this to AccountType; the client is untyped,
    // so the assertion is where that guarantee is re-stated.
    type: row.type as AccountType,
    currency: row.currency,
    archived: row.archived_at !== null,
  };
}

export class SupabaseAccountAdapter implements AccountPort {
  async create(
    workspaceId: string,
    draft: AccountDraft,
  ): Promise<Result<AccountRef, AccountError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase
        .from("accounts")
        .insert({
          workspace_id: workspaceId,
          name: draft.name,
          type: draft.type,
          currency: draft.currency,
          // A STRING, not a number: initial_balance is bigint, and a JS number
          // silently loses precision past 2^53. Money is bigint end to end for
          // this reason, so it must not be narrowed on the way out.
          initial_balance: draft.initialBalanceMinorUnits.toString(),
        })
        .select("id")
        .single();

      if (error) return err(mapPostgresError(error));
      if (!data) return err({ kind: "Unavailable" });

      return ok({ id: data.id as string });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<readonly AccountSummary[], AccountError>> {
    try {
      const supabase = await createServerClient();

      const { data, error } = await supabase
        .from("accounts")
        .select(SUMMARY_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("name");

      if (error) return err(mapPostgresError(error));

      // RLS makes "this workspace has no accounts" and "this is not your
      // workspace" indistinguishable, and an empty list is the honest answer to
      // both — inventing WorkspaceNotFound here would be a guess.
      return ok(((data ?? []) as AccountRow[]).map(toSummary));
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
