import { describe, expect, it } from "vitest";

import {
  type ScheduledDueInput,
  dueWithin,
  nextOccurrence,
  occurrenceInMonth,
} from "./scheduled-due";

function makeSchedule(
  overrides: Partial<ScheduledDueInput> = {},
): ScheduledDueInput {
  return {
    id: "s-1",
    name: "Alquiler",
    kind: "expense",
    amountMinorUnits: 120000n,
    dayOfMonth: 5,
    paused: false,
    ...overrides,
  };
}

describe("occurrenceInMonth", () => {
  it("clamps a day past the end of the month, exactly as the worker does", () => {
    // ez_finance_private.occurrence_in_month uses least(day, days_in_month). Day 31 in
    // February is the 28th — NOT the 3rd of March. An alert naming 3 March would be a
    // date the worker never uses, and the person would plan around it.
    expect(occurrenceInMonth(2026, 1, 31).getDate()).toBe(28);
    expect(occurrenceInMonth(2026, 1, 31).getMonth()).toBe(1);
  });

  it("clamps to 29 in a leap February", () => {
    expect(occurrenceInMonth(2028, 1, 31).getDate()).toBe(29);
  });

  it("clamps 31 to 30 in a thirty-day month", () => {
    // April.
    expect(occurrenceInMonth(2026, 3, 31).getDate()).toBe(30);
  });

  it("leaves a day that exists alone", () => {
    expect(occurrenceInMonth(2026, 7, 15).getDate()).toBe(15);
  });
});

describe("nextOccurrence", () => {
  it("is this month when the day is still ahead", () => {
    const next = nextOccurrence(20, new Date(2026, 7, 5));

    expect(next.getMonth()).toBe(7);
    expect(next.getDate()).toBe(20);
  });

  it("is TODAY when the day is today", () => {
    // The worker materialises overnight, so a schedule due today has not run yet.
    // Rolling to next month would be wrong for the whole day someone could act on it.
    const next = nextOccurrence(5, new Date(2026, 7, 5));

    expect(next.getMonth()).toBe(7);
    expect(next.getDate()).toBe(5);
  });

  it("rolls to next month once the day has passed", () => {
    const next = nextOccurrence(1, new Date(2026, 7, 5));

    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(1);
  });

  it("rolls across a year boundary", () => {
    const next = nextOccurrence(1, new Date(2026, 11, 15));

    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
  });

  it("clamps when it rolls into a short month", () => {
    // Day 31, today is 31 January → February, clamped to the 28th.
    const next = nextOccurrence(31, new Date(2026, 0, 31));

    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(31);

    const after = nextOccurrence(31, new Date(2026, 1, 1));
    expect(after.getMonth()).toBe(1);
    expect(after.getDate()).toBe(28);
  });
});

describe("dueWithin", () => {
  it("includes a schedule due today, with zero days until", () => {
    const due = dueWithin(
      [makeSchedule({ dayOfMonth: 5 })],
      new Date(2026, 7, 5),
      7,
    );

    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ daysUntil: 0, occursOn: "2026-08-05" });
  });

  it("excludes one beyond the window", () => {
    const due = dueWithin(
      [makeSchedule({ dayOfMonth: 20 })],
      new Date(2026, 7, 5),
      7,
    );

    expect(due).toHaveLength(0);
  });

  it("EXCLUDES a paused schedule", () => {
    // It has a day of month and it is not going to run. Warning about it would be
    // warning about something that will not happen.
    const due = dueWithin(
      [makeSchedule({ dayOfMonth: 6, paused: true })],
      new Date(2026, 7, 5),
      7,
    );

    expect(due).toHaveLength(0);
  });

  it("sorts soonest first", () => {
    const due = dueWithin(
      [
        makeSchedule({ id: "later", dayOfMonth: 9 }),
        makeSchedule({ id: "sooner", dayOfMonth: 6 }),
      ],
      new Date(2026, 7, 5),
      7,
    );

    expect(due.map((d) => d.id)).toEqual(["sooner", "later"]);
  });

  it("never reports a negative countdown", () => {
    // A day already past this month rolls forward, so the figure is always the days
    // until the NEXT one — a negative number would read as "overdue", which a
    // recurring schedule never is: the worker already wrote it.
    const due = dueWithin(
      [makeSchedule({ dayOfMonth: 1 })],
      new Date(2026, 7, 5),
      40,
    );

    expect(due[0]?.daysUntil).toBeGreaterThan(0);
  });

  it("carries the amount and kind through for the copy", () => {
    const due = dueWithin(
      [
        makeSchedule({
          dayOfMonth: 5,
          kind: "income",
          amountMinorUnits: 500000n,
        }),
      ],
      new Date(2026, 7, 5),
      7,
    );

    expect(due[0]).toMatchObject({ kind: "income", amountMinorUnits: 500000n });
  });
});
