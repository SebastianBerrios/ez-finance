// supabase-transaction-adapter.ts — implements TransactionPort.
// Only file in the transactions module that talks to @supabase/*.
import type {
  EditableMovement,
  Movement,
  TransactionPort,
  TransactionRef,
} from "@/modules/transactions/application/ports/transaction-port";
import type { TransactionDraft } from "@/modules/transactions/domain/transaction-draft";
import type { TransactionError } from "@/modules/transactions/domain/transaction-error";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { err, ok, type Result } from "@shared/domain/result";

interface PostgresErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Translate a write failure into a domain kind.
 *
 * `P0001` is our own triggers raising: transactions_validate_refs rejects an
 * account or category from another workspace, and it also refuses a write before
 * the workspace has a base currency. Both are told apart by the message, which is
 * the ONLY place a backend string is read — and it never leaves this function.
 */
function mapPostgresError(error: PostgresErrorLike): TransactionError {
  if (error.code === "42501") return { kind: "NotPermitted" };
  if (error.code === "23503") return { kind: "UnknownReference" };

  if (error.code === "P0001") {
    return (error.message ?? "").includes("base currency")
      ? { kind: "WorkspaceNotReady" }
      : { kind: "UnknownReference" };
  }

  return { kind: "Unavailable" };
}

/** First and last day of `date`'s month, inclusive, as YYYY-MM-DD. */
function monthBounds(date: Date): { from: string; to: string } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    // Day 0 of the next month is the last of this one, which sidesteps leap years
    // and 30/31-day months.
    to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

/**
 * A row as PostgREST returns it with embedded names.
 *
 * The embedded shape is an OBJECT for a many-to-one relation but PostgREST types it
 * loosely, so both forms are tolerated when reading the name out.
 */
interface MovementRow {
  readonly id: string;
  readonly kind: string;
  readonly base_amount: string | number;
  readonly occurred_on: string;
  readonly note: string | null;
  readonly transfer_id: string | null;
  readonly transfer_leg: string | null;
  readonly created_by: string | null;
  readonly account: { name: string } | { name: string }[] | null;
  readonly category: { name: string } | { name: string }[] | null;
}

/** The row behind an edit form: ids, and the two columns that decide editability. */
interface EditableRow {
  readonly id: string;
  readonly kind: string;
  readonly base_amount: string | number;
  readonly occurred_on: string;
  readonly account_id: string;
  readonly category_id: string | null;
  readonly note: string | null;
  readonly transfer_id: string | null;
  readonly created_by: string | null;
}

function embeddedName(
  value: { name: string } | { name: string }[] | null,
): string | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : value.name;
}

function toMovement(row: MovementRow, viewerId: string): Movement {
  return {
    id: row.id,
    kind: row.kind as Movement["kind"],
    amountMinorUnits: BigInt(row.base_amount),
    occurredOn: row.occurred_on,
    // An account is NOT NULL on the row, so a missing name means the embed failed
    // rather than that the account is nameless — shown as a dash instead of blank.
    accountName: embeddedName(row.account) ?? "—",
    categoryName: embeddedName(row.category),
    note: row.note,
    transferId: row.transfer_id,
    transferLeg: row.transfer_leg as Movement["transferLeg"],
    // created_by is nulled when the author deletes their account, and a tombstone
    // row belongs to nobody — so it is never "mine".
    isMine: row.created_by !== null && row.created_by === viewerId,
  };
}

export class SupabaseTransactionAdapter implements TransactionPort {
  async record(
    workspaceId: string,
    draft: TransactionDraft,
    authorId: string,
  ): Promise<Result<TransactionRef, TransactionError>> {
    try {
      const supabase = await createServerClient();

      // Amounts as STRINGS: both columns are bigint and a JS number loses
      // precision past 2^53.
      const amount = draft.baseAmountMinorUnits.toString();

      const { data, error } = await supabase
        .from("transactions")
        .insert({
          workspace_id: workspaceId,
          account_id: draft.accountId,
          kind: draft.kind,
          base_amount: amount,
          // Single-currency app: what was entered IS the base, and the frozen rate
          // is 1. The columns for a differing currency are enforced by the schema
          // but nothing writes them yet, so they are filled from the base rather
          // than from a conversion that did not happen.
          entered_amount: amount,
          entered_currency: "PEN",
          exchange_rate: 1,
          occurred_on: draft.occurredOn,
          category_id: draft.categoryId ?? null,
          note: draft.note ?? null,
          // RLS demands this equals auth.uid().
          created_by: authorId,
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

  async listForMonth(
    workspaceId: string,
    month: Date,
    viewerId: string,
  ): Promise<Result<readonly Movement[], TransactionError>> {
    try {
      const supabase = await createServerClient();
      const { from, to } = monthBounds(month);

      // Names come through embedded selects rather than a second round trip and a
      // client-side join. PostgREST resolves them over the foreign keys, and RLS
      // still applies to the embedded tables.
      const { data, error } = await supabase
        .from("transactions")
        .select(
          // The FK is named EXPLICITLY and aliased. transactions has TWO foreign
          // keys to accounts — account_id and counter_account_id — so a bare
          // `accounts(name)` fails with "more than one relationship was found",
          // and the failure arrives as a query error rather than as wrong data.
          "id, kind, base_amount, occurred_on, note, transfer_id, transfer_leg, created_by, account:accounts!transactions_account_id_fkey(name), category:categories(name)",
        )
        .eq("workspace_id", workspaceId)
        .gte("occurred_on", from)
        .lte("occurred_on", to)
        // Newest first, then by insertion so two movements on the same day keep a
        // stable order instead of shuffling between renders.
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) return err(mapPostgresError(error));

      return ok(
        ((data ?? []) as MovementRow[]).map((row) => toMovement(row, viewerId)),
      );
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async findEditable(
    workspaceId: string,
    transactionId: string,
    viewerId: string,
  ): Promise<Result<EditableMovement, TransactionError>> {
    try {
      const supabase = await createServerClient();

      // maybeSingle, not single: single treats "no rows" as an ERROR, which would
      // arrive here as Unavailable and tell someone the app is broken when the truth
      // is that the movement does not exist in this workspace.
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, kind, base_amount, occurred_on, account_id, category_id, note, transfer_id, created_by",
        )
        .eq("workspace_id", workspaceId)
        .eq("id", transactionId)
        .maybeSingle();

      if (error) return err(mapPostgresError(error));
      if (!data) return err({ kind: "UnknownReference" });

      const row = data as EditableRow;

      // Checked before ownership because it is the more specific truth, and it leaks
      // nothing: every role of the workspace may already SELECT this row.
      if (row.transfer_id !== null || row.kind === "transfer") {
        return err({ kind: "TransferNotEditable" });
      }

      // RLS grants SELECT to every role of the workspace but UPDATE only to the
      // author, so a readable row is NOT an editable one. Refusing here is what
      // stops the form from opening on something the save would silently drop.
      if (row.created_by === null || row.created_by !== viewerId) {
        return err({ kind: "NotPermitted" });
      }

      return ok({
        id: row.id,
        // Narrowed rather than cast blindly: the two guards above have already
        // removed 'transfer', and the column's CHECK admits nothing else.
        kind: row.kind === "income" ? "income" : "expense",
        baseAmountMinorUnits: BigInt(row.base_amount),
        occurredOn: row.occurred_on,
        accountId: row.account_id,
        categoryId: row.category_id,
        note: row.note,
      });
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async update(
    workspaceId: string,
    transactionId: string,
    draft: TransactionDraft,
  ): Promise<Result<number, TransactionError>> {
    try {
      const supabase = await createServerClient();

      const amount = draft.baseAmountMinorUnits.toString();

      // .select() for the same reason deleteOne needs it: a refused UPDATE matches
      // zero rows and raises nothing, so without the returned rows "no error" and
      // "changed" are indistinguishable.
      //
      // neq("kind", "transfer") repeats what the UPDATE policy enforces. Belt and
      // braces on purpose — this adapter must not be the thing that breaks a tied
      // pair if it ever runs against a database where the policy is older.
      //
      // workspace_id and created_by are NOT in the payload: an edit corrects what
      // was recorded, it does not move a movement to another space or reassign its
      // author. Leaving them out means no statement can even try.
      const { data, error } = await supabase
        .from("transactions")
        .update({
          account_id: draft.accountId,
          kind: draft.kind,
          base_amount: amount,
          // Single-currency app, so the entered amount tracks the base and the
          // frozen rate stays 1. Writing entered_amount here is what keeps the row
          // honest: leaving it at the old value would claim the person typed one
          // figure and the app stored another.
          entered_amount: amount,
          exchange_rate: 1,
          occurred_on: draft.occurredOn,
          category_id: draft.categoryId ?? null,
          note: draft.note ?? null,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", transactionId)
        .neq("kind", "transfer")
        .select("id");

      if (error) return err(mapPostgresError(error));

      return ok((data ?? []).length);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async deleteOne(
    workspaceId: string,
    transactionId: string,
  ): Promise<Result<number, TransactionError>> {
    try {
      const supabase = await createServerClient();

      // .select() is what makes the count knowable. Without it a refused DELETE is
      // indistinguishable from a successful one: RLS filters the row out, so
      // nothing is deleted and nothing is raised.
      const { data, error } = await supabase
        .from("transactions")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", transactionId)
        .select("id");

      if (error) return err(mapPostgresError(error));

      return ok((data ?? []).length);
    } catch {
      return err({ kind: "Unavailable" });
    }
  }

  async deleteTransfer(
    transferId: string,
  ): Promise<Result<number, TransactionError>> {
    try {
      const supabase = await createServerClient();

      // The RPC owns "both legs or neither" and re-checks membership itself; it
      // returns the number of rows it removed.
      const { data, error } = await supabase.rpc("delete_transfer", {
        p_transfer_id: transferId,
      });

      if (error) return err(mapPostgresError(error));

      return ok(Number(data ?? 0));
    } catch {
      return err({ kind: "Unavailable" });
    }
  }
}
