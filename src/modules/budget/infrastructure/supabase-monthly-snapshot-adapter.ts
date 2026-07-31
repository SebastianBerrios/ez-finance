// supabase-monthly-snapshot-adapter.ts — implements MonthlySnapshotPort.
//
// Reads a month WHOLE and hands it to the engine unaggregated. No SUM, no GROUP BY,
// no CASE on kind: the rules for what a transfer to a savings account means, which
// categories count and how an unbucketed expense is treated all live in
// computeBudget, where they are pure and tested. Pushing any of them into SQL would
// duplicate them somewhere the domain suite cannot see.
import type { MonthlySnapshotPort } from "@/modules/budget/application/ports/monthly-snapshot-port";
import type { BudgetConfigError } from "@/modules/budget/domain/budget-config-error";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import type {
  AccountType,
  Bucket,
  MonthlySnapshot,
  SnapshotAccount,
  SnapshotCategory,
  SnapshotTransaction,
  TransactionKind,
  TransferLeg,
} from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
}

function mapPostgresError(error: PostgresErrorLike): BudgetConfigError {
  switch (error.code) {
    case "42501":
      return { kind: "NotPermitted" };
    case "23503":
      return { kind: "WorkspaceNotFound" };
    default:
      return { kind: "Unavailable" };
  }
}

/** First and last day of `date`'s month, inclusive, as YYYY-MM-DD. */
function monthBounds(date: Date): { from: string; to: string } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  // Day 0 of the NEXT month is the last day of this one, which also sidesteps
  // leap years and 30/31-day months.
  const last = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

interface AccountRow {
  readonly id: string;
  readonly type: string;
}

interface CategoryRow {
  readonly id: string;
  readonly bucket: string | null;
  readonly archived_at: string | null;
  readonly parent_id: string | null;
}

interface TransactionRow {
  readonly id: string;
  readonly kind: string;
  readonly base_amount: string | number;
  readonly occurred_on: string;
  readonly account_id: string;
  readonly category_id: string | null;
  readonly transfer_id: string | null;
  readonly transfer_leg: string | null;
  readonly counter_account_id: string | null;
}

export class SupabaseMonthlySnapshotAdapter implements MonthlySnapshotPort {
  async readForMonth(
    workspaceId: string,
    month: Date,
  ): Promise<Result<MonthlySnapshot | null, BudgetConfigError>> {
    try {
      const supabase = await createServerClient();
      const { from, to } = monthBounds(month);

      const workspace = await supabase
        .from("workspaces")
        .select("base_currency")
        .eq("id", workspaceId)
        .maybeSingle();

      if (workspace.error) return err(mapPostgresError(workspace.error));

      const baseCurrencyCode = (
        workspace.data as { base_currency: string | null } | null
      )?.base_currency;

      // No base currency means no account has ever been created, so there is
      // nothing to compute. Unfinished setup, not a failure.
      if (!baseCurrencyCode) return ok(null);

      const baseCurrency = fromMinorUnits(baseCurrencyCode, 0n);
      if (!baseCurrency.ok) {
        // Stored a code Money does not know. No app path can do this.
        return err({ kind: "Unavailable" });
      }

      const [accounts, categories, transactions] = await Promise.all([
        supabase
          .from("accounts")
          .select("id, type")
          .eq("workspace_id", workspaceId),
        supabase
          .from("categories")
          .select("id, bucket, archived_at, parent_id")
          .eq("workspace_id", workspaceId),
        supabase
          .from("transactions")
          .select(
            "id, kind, base_amount, occurred_on, account_id, category_id, transfer_id, transfer_leg, counter_account_id",
          )
          .eq("workspace_id", workspaceId)
          // Inclusive on both ends: occurred_on is a DATE, so the last day of the
          // month must be included rather than excluded by a `<` on the 1st.
          .gte("occurred_on", from)
          .lte("occurred_on", to),
      ]);

      if (accounts.error) return err(mapPostgresError(accounts.error));
      if (categories.error) return err(mapPostgresError(categories.error));
      if (transactions.error) return err(mapPostgresError(transactions.error));

      // ARCHIVED ROWS ARE INCLUDED, both here and for categories. The engine reads
      // `archived` and deliberately counts them anyway, because a movement recorded
      // in March against a category archived in May still happened. Filtering here
      // would quietly rewrite history — the exact thing §3.4 forbids.
      const snapshotAccounts: SnapshotAccount[] = (
        (accounts.data ?? []) as AccountRow[]
      ).map((row) => ({ id: row.id, type: row.type as AccountType }));

      const snapshotCategories: SnapshotCategory[] = (
        (categories.data ?? []) as CategoryRow[]
      ).map((row) =>
        // parentId is built conditionally: exactOptionalPropertyTypes is on, so an
        // absent parent must OMIT the key rather than set it to undefined.
        row.parent_id === null
          ? {
              id: row.id,
              bucket: row.bucket === null ? null : (row.bucket as Bucket),
              archived: row.archived_at !== null,
            }
          : {
              id: row.id,
              bucket: row.bucket === null ? null : (row.bucket as Bucket),
              archived: row.archived_at !== null,
              parentId: row.parent_id,
            },
      );

      const snapshotTransactions: SnapshotTransaction[] = [];

      for (const row of (transactions.data ?? []) as TransactionRow[]) {
        const amount = fromMinorUnits(
          baseCurrencyCode,
          BigInt(row.base_amount),
        );
        if (!amount.ok) return err({ kind: "Unavailable" });

        // Assembled key by key for the same exactOptionalPropertyTypes reason: the
        // engine distinguishes an ABSENT categoryId (a transfer leg) from a present
        // one, and `undefined` is not absence.
        const base = {
          id: row.id,
          kind: row.kind as TransactionKind,
          amount: amount.value,
          date: row.occurred_on,
          accountId: row.account_id,
        };

        const withCategory =
          row.category_id === null
            ? base
            : { ...base, categoryId: row.category_id };

        const withTransfer =
          row.transfer_id === null ||
          row.transfer_leg === null ||
          row.counter_account_id === null
            ? withCategory
            : {
                ...withCategory,
                transferId: row.transfer_id,
                transferLeg: row.transfer_leg as TransferLeg,
                counterAccountId: row.counter_account_id,
              };

        snapshotTransactions.push(withTransfer);
      }

      return ok({
        year: month.getUTCFullYear(),
        // The engine wants 1-12; getUTCMonth is 0-11.
        month: month.getUTCMonth() + 1,
        baseCurrency: baseCurrency.value.currency,
        transactions: snapshotTransactions,
        categories: snapshotCategories,
        accounts: snapshotAccounts,
      });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
