// supabase-account-adapter.ts — implements AccountPort.
// The ONLY file in the accounts module that talks to @supabase/*. Every backend
// error is funnelled through mapPostgresError(); no Postgres code, constraint
// name or message escapes past this file.
import type {
  AccountPort,
  AccountRef,
  AccountSummary,
  AccountWithBalance,
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

/** One row of ez_finance.account_balances(). bigint arrives as a string. */
interface BalanceRow {
  readonly account_id: string;
  readonly balance: string | number;
  readonly movement_count: string | number;
}

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

  async archive(
    workspaceId: string,
    accountId: string,
  ): Promise<Result<void, AccountError>> {
    return this.setArchivedAt(workspaceId, accountId, new Date().toISOString());
  }

  async unarchive(
    workspaceId: string,
    accountId: string,
  ): Promise<Result<void, AccountError>> {
    return this.setArchivedAt(workspaceId, accountId, null);
  }

  /**
   * The one write both archive and unarchive perform, differing only in the value.
   *
   * ZERO ROWS AFFECTED IS A FAILURE, and this is the whole reason it is a shared
   * helper rather than two copies. RLS does not raise on a forbidden UPDATE — it
   * filters the row out, so nothing changes and nothing errors, and a naive caller
   * reads that as success. `count: "exact"` turns "no" into an answer instead of a
   * silence, the same rule deleteMovement follows.
   */
  private async setArchivedAt(
    workspaceId: string,
    accountId: string,
    value: string | null,
  ): Promise<Result<void, AccountError>> {
    try {
      const supabase = await createServerClient();

      const { error, count } = await supabase
        .from("accounts")
        .update({ archived_at: value }, { count: "exact" })
        // Scoped by workspace as well as by id: RLS already blocks another
        // workspace's rows, but leaning on that alone means a future policy change
        // silently widens what this call can touch.
        .eq("workspace_id", workspaceId)
        .eq("id", accountId);

      if (error) return err(mapPostgresError(error));

      if (count === 0) return err({ kind: "NotPermitted" });

      return ok(undefined);
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

  async listWithBalances(
    workspaceId: string,
  ): Promise<Result<readonly AccountWithBalance[], AccountError>> {
    try {
      const supabase = await createServerClient();

      // Two reads rather than a join, because the balance comes from an RPC and the
      // names come from the table. Both are already scoped by RLS, so the join is
      // done here in one pass over a handful of rows.
      const [accounts, balances] = await Promise.all([
        this.listByWorkspace(workspaceId),
        supabase.rpc("account_balances", { p_workspace_id: workspaceId }),
      ]);

      if (!accounts.ok) return accounts;
      if (balances.error) return err(mapPostgresError(balances.error));

      const byAccount = new Map<string, BalanceRow>();
      for (const row of (balances.data ?? []) as BalanceRow[]) {
        byAccount.set(row.account_id, row);
      }

      return ok(
        accounts.value.map((account) => {
          const row = byAccount.get(account.id);
          return {
            ...account,
            // A missing row would mean the RPC and the table disagree about which
            // accounts exist. Falling back to 0 rather than dropping the account:
            // an account absent from a list is invisible, while a zero is a figure
            // someone will question.
            balanceMinorUnits: row ? BigInt(row.balance) : 0n,
            movementCount: row ? Number(row.movement_count) : 0,
          };
        }),
      );
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
