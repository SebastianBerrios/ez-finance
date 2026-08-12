import { splitDraft } from "@/modules/splits/domain/split-draft";
import type { SplitError } from "@/modules/splits/domain/split-error";
import { err, type Result } from "@shared/domain/result";

import type { SplitPort, SplitRef } from "./ports/split-port";

interface RecordSplitExpenseInput {
  readonly workspaceId: string;
  readonly myShareMinorUnits: bigint;
  readonly accountId: string;
  readonly categoryId?: string;
  readonly occurredOn: string;
  readonly note?: string;
  readonly debtors: readonly {
    readonly name: string;
    readonly amountMinorUnits: bigint;
  }[];
}

interface RecordSplitExpenseDeps {
  readonly splits: SplitPort;
}

/**
 * Record a shared expense.
 *
 * Validation happens here so a bad debtor name or a zero amount costs no round trip,
 * and so the message names the field instead of reverse-engineering a Postgres
 * exception. The RPC validates the same rules again — it has to, since it is the only
 * thing standing between the database and any other client — and that duplication is
 * deliberate rather than accidental.
 */
export async function recordSplitExpense(
  input: RecordSplitExpenseInput,
  deps: RecordSplitExpenseDeps,
): Promise<Result<SplitRef | null, SplitError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotReady" });
  }

  const draft = splitDraft.create({
    myShareMinorUnits: input.myShareMinorUnits,
    accountId: input.accountId,
    occurredOn: input.occurredOn,
    debtors: input.debtors,
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    ...(input.note === undefined ? {} : { note: input.note }),
  });

  if (!draft.ok) return err(draft.error);

  return deps.splits.recordSplitExpense(input.workspaceId, draft.value);
}
