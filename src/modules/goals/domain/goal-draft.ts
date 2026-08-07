// goal-draft.ts — pure domain: validate a goal before the database sees it.
//
// The rules mirror the column constraints in 20260802100000 exactly: a trimmed name of
// 1–80 characters, a strictly positive target, and a date that is either absent or a
// real YYYY-MM-DD. Duplicating them here turns a 23514 constraint violation into a
// sentence someone can act on.

import type { Result } from "@shared/domain/result";
import { err, ok } from "@shared/domain/result";

import type { GoalError } from "./goal-error";

/** Matches the column's own `between 1 and 80`, measured on the trimmed name. */
export const NAME_MAX = 80;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface GoalDraft {
  readonly name: string;
  readonly accountId: string;
  readonly targetAmountMinorUnits: bigint;
  /** Omitted, never undefined — exactOptionalPropertyTypes is on. */
  readonly targetDate?: string;
}

export interface GoalDraftInput {
  readonly name: string;
  readonly accountId: string;
  readonly targetAmountMinorUnits: bigint;
  readonly targetDate?: string;
}

/** A real calendar date, not merely the right shape: 2026-02-31 is neither. */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined)
    return false;

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Validate a new goal.
 *
 * Errors are reported in a FIXED order — name, account, target, date — so someone
 * fixing several faults is told about the same one until it is fixed, rather than
 * being sent around in a circle.
 */
export function goalDraft(input: GoalDraftInput): Result<GoalDraft, GoalError> {
  const name = input.name.trim();

  if (name.length === 0) return err({ kind: "NameRequired" });
  if (name.length > NAME_MAX) return err({ kind: "NameTooLong" });

  const accountId = input.accountId.trim();
  if (accountId.length === 0) return err({ kind: "AccountRequired" });

  if (input.targetAmountMinorUnits <= 0n) {
    return err({ kind: "TargetNotPositive" });
  }

  const rawDate = input.targetDate?.trim() ?? "";

  // An empty <input type="date"> submits "". That is "no deadline", not a bad one — so
  // it is omitted from the draft rather than rejected or stored as an empty string.
  if (rawDate.length === 0) {
    return ok(
      Object.freeze({
        name,
        accountId,
        targetAmountMinorUnits: input.targetAmountMinorUnits,
      }),
    );
  }

  if (!isRealDate(rawDate)) return err({ kind: "InvalidDate" });

  return ok(
    Object.freeze({
      name,
      accountId,
      targetAmountMinorUnits: input.targetAmountMinorUnits,
      targetDate: rawDate,
    }),
  );
}
