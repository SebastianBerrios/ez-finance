// goal-pace.ts — pure domain: "am I going to make it?"
//
// WHAT "EN RIESGO" MEANS HERE, because the spec asks for the words and not the rule.
// Spec §5.8: "El seguimiento de ritmo compara lo ahorrado hasta ahora con lo que haría
// falta ahorrar por mes para llegar a la fecha objetivo."
//
// The comparison needs a baseline, and there is no contribution history to build one
// from — `saved` is DERIVED from the account balance, so the app knows the total but
// not how it got there. The only honest baseline is the goal's own window: if 60 % of
// the time between starting and the deadline has passed, roughly 60 % should be saved.
// Behind that line is behind.
//
// The alternative was a rule with nothing behind it. "At risk when the deadline is
// within 30 days" would shout at a goal that is 99 % funded and stay silent on one at
// 5 % with two months left — which is worse than no signal, because a signal people
// learn to ignore also hides the real one.
//
// NO TOLERANCE BAND, deliberately. A goal exactly on the line is on track; one cent
// behind is at risk. A grace margin would be a second invented number, and the honest
// place to soften this is the copy on the screen, not the arithmetic.
import type { Result } from "@shared/domain/result";
import { err, ok } from "@shared/domain/result";

export type GoalPaceError =
  /** The window ends before it starts — nothing sensible to say about the pace. */
  { readonly kind: "InvalidWindow" };

export type GoalPace =
  /** Saved has reached the target. Nothing left to be at risk about. */
  | { readonly kind: "ACHIEVED" }
  /** No target date: a goal without a deadline cannot be behind one. */
  | { readonly kind: "NO_DEADLINE" }
  /** The deadline has passed and the target was never reached. */
  | { readonly kind: "OVERDUE"; readonly missingMinorUnits: bigint }
  | {
      readonly kind: "ON_TRACK" | "AT_RISK";
      readonly missingMinorUnits: bigint;
      /** Days from today to the target date, at least 1. */
      readonly daysLeft: number;
      /**
       * What still has to be saved per remaining month to arrive on time, rounded
       * UP: rounding down would produce a figure that, followed exactly, arrives
       * short — which is the one direction a savings target must never err in.
       */
      readonly monthlyNeededMinorUnits: bigint;
    };

export interface GoalPaceInput {
  readonly targetMinorUnits: bigint;
  readonly savedMinorUnits: bigint;
  /** YYYY-MM-DD, or null for a goal with no deadline. */
  readonly targetDate: string | null;
  /** When the goal was created — the start of the window. */
  readonly startedAt: Date;
  /** Resolved by the caller, never `new Date()` in here, so this stays testable. */
  readonly today: Date;
}

const MS_PER_DAY = 86_400_000;
/** Average month, used only to turn "days left" into "months left". */
const DAYS_PER_MONTH = 30;

/** Whole days between two dates, ignoring the time of day. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-tripped, so 2026-02-30 is refused rather than rolled into March.
  if (parsed.toISOString().slice(0, 10) !== value) return null;
  // Read back in local terms: everything else here is calendar-day arithmetic.
  return new Date(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
}

/** Ceiling division for positive divisors, on bigint. */
function divideRoundingUp(amount: bigint, by: bigint): bigint {
  if (by <= 0n) return amount;
  return (amount + by - 1n) / by;
}

export function goalPace(
  input: GoalPaceInput,
): Result<GoalPace, GoalPaceError> {
  const missing = input.targetMinorUnits - input.savedMinorUnits;

  // Checked BEFORE the deadline: a goal reached late is reached, and calling it
  // overdue would be telling someone they failed at something they finished.
  if (missing <= 0n) return ok({ kind: "ACHIEVED" });

  if (input.targetDate === null) return ok({ kind: "NO_DEADLINE" });

  const target = parseDate(input.targetDate);
  if (target === null) return err({ kind: "InvalidWindow" });

  const daysLeft = daysBetween(input.today, target);

  // The deadline is today or past. Today counts as still open — someone can save on
  // the last day — so only a strictly negative remainder is overdue.
  if (daysLeft < 0) {
    return ok({ kind: "OVERDUE", missingMinorUnits: missing });
  }

  const totalDays = daysBetween(input.startedAt, target);
  if (totalDays < 0) return err({ kind: "InvalidWindow" });

  // At least one day and one month, so the arithmetic never divides by zero and the
  // figure shown on the last day is "all of it" rather than infinity.
  const daysRemaining = Math.max(daysLeft, 1);
  const monthsRemaining = BigInt(
    Math.max(1, Math.ceil(daysRemaining / DAYS_PER_MONTH)),
  );

  const monthlyNeeded = divideRoundingUp(missing, monthsRemaining);

  // The pace comparison, in integers to avoid float drift: saved/target versus
  // elapsed/total, cross-multiplied.
  //
  // A window of zero days (created on its own deadline) has no elapsed fraction to
  // compare, and the answer that matters is simply whether it is funded — which it is
  // not, or we would have returned ACHIEVED. Treated as at risk.
  const elapsedDays = totalDays - daysLeft;
  const behind =
    totalDays === 0
      ? true
      : input.savedMinorUnits * BigInt(totalDays) <
        input.targetMinorUnits * BigInt(elapsedDays);

  return ok({
    kind: behind ? "AT_RISK" : "ON_TRACK",
    missingMinorUnits: missing,
    daysLeft: daysRemaining,
    monthlyNeededMinorUnits: monthlyNeeded,
  });
}
