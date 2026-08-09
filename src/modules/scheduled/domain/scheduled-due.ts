// scheduled-due.ts — pure domain: "what is about to be charged?"
//
// Spec §5.11 asks for an alert when "una cuota está por vencer". A schedule stores a
// DAY OF MONTH, so the next occurrence is derivable and needs no query — which matters,
// because the alternative was a second read on the dashboard's critical path.
//
// IT CLAMPS THE DAY EXACTLY AS THE WORKER DOES. ez_finance_private.occurrence_in_month
// resolves a day past the end of a month with `least(day, days_in_month)`: day 31 in
// February is the 28th, not the 3rd of March. This file has to agree, or the alert
// promises a date the worker will not use — and a warning that names the wrong day is
// worse than none, because the person plans around it.
//
// `today` is always passed in. A domain function that reads the clock cannot be tested
// against the boundary cases that matter here, and those boundaries — the day itself,
// the last day of a short month — are the whole point.

export interface ScheduledDueInput {
  readonly id: string;
  readonly name: string;
  readonly kind: "income" | "expense";
  readonly amountMinorUnits: bigint;
  readonly dayOfMonth: number;
  readonly paused: boolean;
}

export interface ScheduledDue {
  readonly id: string;
  readonly name: string;
  readonly kind: "income" | "expense";
  readonly amountMinorUnits: bigint;
  /** YYYY-MM-DD, already clamped to the month's length. */
  readonly occursOn: string;
  /** 0 means today. Never negative — a past occurrence is not upcoming. */
  readonly daysUntil: number;
}

const MS_PER_DAY = 86_400_000;

/** Days in a month, `month` being 0-based like Date's. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, which sidesteps leap years.
  return new Date(year, month + 1, 0).getDate();
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * The occurrence in a given month, clamped — the mirror of
 * ez_finance_private.occurrence_in_month.
 */
export function occurrenceInMonth(
  year: number,
  month: number,
  dayOfMonth: number,
): Date {
  return new Date(year, month, Math.min(dayOfMonth, daysInMonth(year, month)));
}

/**
 * The next occurrence on or after `today`.
 *
 * TODAY COUNTS. A schedule due today has not run yet — the worker materialises
 * overnight — so telling someone it already happened would be wrong for the whole day
 * they could still act on it.
 */
export function nextOccurrence(dayOfMonth: number, today: Date): Date {
  const thisMonth = occurrenceInMonth(
    today.getFullYear(),
    today.getMonth(),
    dayOfMonth,
  );

  if (daysBetween(today, thisMonth) >= 0) return thisMonth;

  return occurrenceInMonth(
    today.getFullYear(),
    today.getMonth() + 1,
    dayOfMonth,
  );
}

/**
 * The schedules whose next occurrence falls within `withinDays`, soonest first.
 *
 * PAUSED ONES ARE OUT. A paused schedule has a day of month and will not run, so
 * warning about it would be warning about something that is not going to happen.
 */
export function dueWithin(
  schedules: readonly ScheduledDueInput[],
  today: Date,
  withinDays: number,
): readonly ScheduledDue[] {
  return schedules
    .filter((schedule) => !schedule.paused)
    .map((schedule) => {
      const occurs = nextOccurrence(schedule.dayOfMonth, today);
      return {
        id: schedule.id,
        name: schedule.name,
        kind: schedule.kind,
        amountMinorUnits: schedule.amountMinorUnits,
        occursOn: isoDate(occurs),
        daysUntil: daysBetween(today, occurs),
      };
    })
    .filter((due) => due.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}
