// transaction-draft.ts — a validated income or expense, ready to be written.
//
// TRANSFERS ARE NOT REPRESENTABLE HERE, deliberately. A transfer is a tied pair of
// rows sharing a transfer_id, created and undone together (spec §5.5), and one
// draft cannot express two rows. ez_finance.record_transfer() owns that, and the
// INSERT policy refuses a lone leg — so accepting kind "transfer" here would only
// move the failure from a readable form error to an unreadable policy violation.
import { err, ok, type Result } from "@shared/domain/result";

import type { TransactionError } from "./transaction-error";

/** The kinds a single row can express on its own. */
export type SingleEntryKind = "income" | "expense";

const SINGLE_ENTRY_KINDS: readonly SingleEntryKind[] = ["income", "expense"];

/** Matches the length CHECK on ez_finance.transactions.note. */
const NOTE_MAX = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface TransactionDraft {
  readonly kind: SingleEntryKind;
  /** POSITIVE magnitude in the workspace base currency; the sign is the kind. */
  readonly baseAmountMinorUnits: bigint;
  /** YYYY-MM-DD, workspace-local. Date-only: the engine groups by month. */
  readonly occurredOn: string;
  readonly accountId: string;
  readonly categoryId?: string;
  readonly note?: string;
}

export interface TransactionDraftInput {
  readonly kind: string;
  readonly baseAmountMinorUnits: bigint;
  readonly occurredOn: string;
  readonly accountId: string;
  readonly categoryId?: string;
  readonly note?: string;
}

/**
 * True only for a date that exists.
 *
 * The regex alone would accept 2026-02-29 and 2026-13-01, so the value is
 * round-tripped through a real Date and compared back — the only way to catch a
 * day the month does not have.
 */
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  // Date rolls 2026-02-29 forward to 2026-03-01, so the round trip differs.
  return parsed.toISOString().slice(0, 10) === value;
}

function create(
  input: TransactionDraftInput,
): Result<TransactionDraft, TransactionError> {
  const kind = SINGLE_ENTRY_KINDS.find((candidate) => candidate === input.kind);
  if (kind === undefined) {
    return err({ kind: "InvalidKind" });
  }

  if (input.baseAmountMinorUnits <= 0n) {
    return err({ kind: "InvalidAmount" });
  }

  if (!isRealIsoDate(input.occurredOn)) {
    return err({ kind: "InvalidDate" });
  }

  const accountId = input.accountId.trim();
  if (accountId.length === 0) {
    return err({ kind: "AccountRequired" });
  }

  const note = input.note?.trim() ?? "";
  if (note.length > NOTE_MAX) {
    return err({ kind: "NoteTooLong" });
  }

  const categoryId = input.categoryId?.trim() ?? "";

  // Assembled key by key rather than with possibly-undefined values:
  // exactOptionalPropertyTypes is on, and the engine distinguishes an ABSENT
  // categoryId from a present one — an uncategorised expense is totalled per
  // category and lands in NO bucket. An empty <select> submits "", which is not a
  // category, so it is treated as absence too.
  const base = {
    kind,
    baseAmountMinorUnits: input.baseAmountMinorUnits,
    occurredOn: input.occurredOn,
    accountId,
  };

  const withCategory =
    categoryId.length === 0 ? base : { ...base, categoryId };

  return ok(
    Object.freeze(note.length === 0 ? withCategory : { ...withCategory, note }),
  );
}

export const transactionDraft = { create } as const;
