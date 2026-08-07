// scheduled-draft.ts — pure domain: validate a schedule before the database sees it.
//
// Mirrors the column constraints in 20260802140000 exactly, including the one that is
// easy to read as arbitrary: KIND excludes 'transfer'. A transfer is a tied pair written
// by record_transfer(), so a scheduler that produced one leg would corrupt the very
// invariant the transfers design exists to protect.

import type { Result } from "@shared/domain/result";
import { err, ok } from "@shared/domain/result";

import type { ScheduledError } from "./scheduled-error";

export const NAME_MAX = 80;
export const NOTE_MAX = 500;

const KINDS: readonly string[] = ["income", "expense"];

export interface ScheduledDraft {
  readonly name: string;
  readonly kind: "income" | "expense";
  readonly accountId: string;
  readonly amountMinorUnits: bigint;
  readonly dayOfMonth: number;
  readonly categoryId?: string;
  readonly note?: string;
}

export interface ScheduledDraftInput {
  readonly name: string;
  readonly kind: string;
  readonly accountId: string;
  readonly amountMinorUnits: bigint;
  readonly dayOfMonth: number;
  readonly categoryId?: string;
  readonly note?: string;
}

/**
 * Validate a new schedule.
 *
 * The day is 1–31 and NOT clamped here. Clamping is the database's job
 * (occurrence_in_month), because "the 31st" has to mean "the end of the month" every
 * month, not whatever the month of creation happened to allow.
 */
export function scheduledDraft(
  input: ScheduledDraftInput,
): Result<ScheduledDraft, ScheduledError> {
  const name = input.name.trim();
  if (name.length === 0) return err({ kind: "NameRequired" });
  if (name.length > NAME_MAX) return err({ kind: "NameTooLong" });

  if (!KINDS.includes(input.kind)) return err({ kind: "InvalidKind" });

  const accountId = input.accountId.trim();
  if (accountId.length === 0) return err({ kind: "AccountRequired" });

  if (input.amountMinorUnits <= 0n) return err({ kind: "AmountNotPositive" });

  if (
    !Number.isInteger(input.dayOfMonth) ||
    input.dayOfMonth < 1 ||
    input.dayOfMonth > 31
  ) {
    return err({ kind: "InvalidDay" });
  }

  const note = input.note?.trim() ?? "";
  if (note.length > NOTE_MAX) return err({ kind: "NoteTooLong" });

  const categoryId = input.categoryId?.trim() ?? "";

  return ok(
    Object.freeze({
      name,
      kind: input.kind as "income" | "expense",
      accountId,
      amountMinorUnits: input.amountMinorUnits,
      dayOfMonth: input.dayOfMonth,
      // Omitted rather than empty: an untouched <select> submits "", which is "no
      // category", and the engine distinguishes that from a category that exists.
      ...(categoryId.length === 0 ? {} : { categoryId }),
      ...(note.length === 0 ? {} : { note }),
    }),
  );
}
