// split-draft.ts — pure domain: a shared expense, validated before the RPC sees it.
//
// The rules mirror ez_finance.record_split_expense exactly. Duplicating them is not
// belt-and-braces: the RPC signals every refusal as a Postgres exception, and turning
// those back into a sentence someone can act on is work the adapter should not have to
// do for a mistake catchable before the round trip — the same reasoning
// workspace-draft.ts and transaction-draft.ts already state.
import { err, ok, type Result } from "@shared/domain/result";

import type { SplitError } from "./split-error";

/** Matches the length CHECK on ez_finance.expense_splits.debtor_name. */
export const DEBTOR_NAME_MAX = 80;

/** How many people one expense can be split with, per call. */
const DEBTORS_MAX = 20;

export interface DebtorShare {
  readonly name: string;
  /** Minor units, strictly positive. */
  readonly amountMinorUnits: bigint;
}

export interface SplitDraft {
  /**
   * What YOU consumed. May be zero — paying for someone else's dinner in full is a
   * real thing, and refusing it would force recording a fake expense.
   */
  readonly myShareMinorUnits: bigint;
  readonly accountId: string;
  readonly categoryId?: string;
  readonly occurredOn: string;
  readonly note?: string;
  readonly debtors: readonly DebtorShare[];
}

export interface SplitDraftInput {
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a date that exists — 2026-02-30 is refused, not rolled forward. */
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function create(input: SplitDraftInput): Result<SplitDraft, SplitError> {
  // Negative is nonsense; zero is not. See the field comment.
  if (input.myShareMinorUnits < 0n) return err({ kind: "InvalidShare" });

  const accountId = input.accountId.trim();
  if (accountId.length === 0) return err({ kind: "AccountRequired" });

  if (!isRealIsoDate(input.occurredOn)) return err({ kind: "InvalidDate" });

  if (input.debtors.length === 0) return err({ kind: "DebtorsRequired" });
  if (input.debtors.length > DEBTORS_MAX)
    return err({ kind: "TooManyDebtors" });

  const debtors: DebtorShare[] = [];

  for (const debtor of input.debtors) {
    const name = debtor.name.trim();
    if (name.length === 0) return err({ kind: "DebtorNameRequired" });
    if (name.length > DEBTOR_NAME_MAX)
      return err({ kind: "DebtorNameTooLong" });
    // A debtor who owes nothing is not a debtor. Refused rather than dropped: a row
    // silently removed is a person the user believes they recorded.
    if (debtor.amountMinorUnits <= 0n)
      return err({ kind: "InvalidDebtorAmount" });

    debtors.push({ name, amountMinorUnits: debtor.amountMinorUnits });
  }

  const note = input.note?.trim() ?? "";
  const categoryId = input.categoryId?.trim() ?? "";

  // Assembled key by key rather than with possibly-undefined values:
  // exactOptionalPropertyTypes is on, and an ABSENT categoryId is not the same as one
  // present and undefined — an empty <select> submits "", which is not a category.
  const base = {
    myShareMinorUnits: input.myShareMinorUnits,
    accountId,
    occurredOn: input.occurredOn,
    debtors: Object.freeze(debtors),
  };

  const withCategory = categoryId.length === 0 ? base : { ...base, categoryId };

  return ok(
    Object.freeze(note.length === 0 ? withCategory : { ...withCategory, note }),
  );
}

/**
 * What the others owe in total — the amount that moves into "Por cobrar".
 *
 * Derived, never taken from the caller. The RPC derives it the same way from the same
 * list, so the expense, the transfer and the split rows cannot disagree about the
 * total by construction rather than by everyone adding correctly.
 */
export function owedTotal(draft: SplitDraft): bigint {
  return draft.debtors.reduce(
    (sum, debtor) => sum + debtor.amountMinorUnits,
    0n,
  );
}

/** What you actually paid: your share plus what you are owed. */
export function paidTotal(draft: SplitDraft): bigint {
  return draft.myShareMinorUnits + owedTotal(draft);
}

export const splitDraft = { create } as const;
