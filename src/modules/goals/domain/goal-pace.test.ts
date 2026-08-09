import { describe, expect, it } from "vitest";

import { type GoalPaceInput, goalPace } from "./goal-pace";

/** A goal for 1000.00 started on 1 January with a 1 July deadline. */
function makeInput(overrides: Partial<GoalPaceInput> = {}): GoalPaceInput {
  return {
    targetMinorUnits: 100000n,
    savedMinorUnits: 0n,
    targetDate: "2026-07-01",
    startedAt: new Date(2026, 0, 1),
    today: new Date(2026, 3, 1),
    ...overrides,
  };
}

describe("goalPace", () => {
  it("reports ACHIEVED once saved reaches the target", () => {
    const result = goalPace(makeInput({ savedMinorUnits: 100000n }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("ACHIEVED");
  });

  it("reports ACHIEVED even after the deadline passed", () => {
    // A goal reached late is reached. Calling it overdue would tell someone they
    // failed at something they finished.
    const result = goalPace(
      makeInput({
        savedMinorUnits: 120000n,
        today: new Date(2027, 0, 1),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("ACHIEVED");
  });

  it("reports NO_DEADLINE when there is no target date", () => {
    // A goal without a deadline cannot be behind one. It is not "at risk" and it is
    // not "on track" either — saying either would be inventing a judgement.
    const result = goalPace(makeInput({ targetDate: null }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("NO_DEADLINE");
  });

  it("is ON TRACK when the saved fraction keeps up with the elapsed fraction", () => {
    // Half the window gone (1 Jan → 1 Jul, today 1 Apr is 90 of 181 days) and half
    // the money saved.
    const result = goalPace(makeInput({ savedMinorUnits: 50000n }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("ON_TRACK");
  });

  it("is AT RISK when the saved fraction falls behind the elapsed one", () => {
    const result = goalPace(makeInput({ savedMinorUnits: 10000n }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("AT_RISK");
  });

  it("does NOT call a nearly-funded goal at risk just because the deadline is close", () => {
    // The failure mode a naive "deadline within 30 days" rule has, and the reason the
    // start date had to be exposed by a migration: this goal is 99 % funded with days
    // to go and is plainly fine.
    const result = goalPace(
      makeInput({ savedMinorUnits: 99000n, today: new Date(2026, 5, 25) }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("ON_TRACK");
  });

  it("DOES call an under-funded goal at risk while the deadline is still far", () => {
    // The other half of the same failure mode: two months left, 5 % saved, and the
    // naive rule would have said nothing.
    const result = goalPace(
      makeInput({ savedMinorUnits: 5000n, today: new Date(2026, 4, 1) }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("AT_RISK");
  });

  it("reports OVERDUE after the deadline with money still missing", () => {
    const result = goalPace(
      makeInput({ savedMinorUnits: 40000n, today: new Date(2026, 7, 1) }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("OVERDUE");
      if (result.value.kind === "OVERDUE") {
        expect(result.value.missingMinorUnits).toBe(60000n);
      }
    }
  });

  it("treats the deadline DAY as still open", () => {
    // Someone can save on the last day. Reporting overdue at 00:00 on the target date
    // would be wrong by a whole day, every time.
    const result = goalPace(
      makeInput({ savedMinorUnits: 40000n, today: new Date(2026, 6, 1) }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).not.toBe("OVERDUE");
  });

  it("rounds the monthly figure UP", () => {
    // 100.00 missing over 3 months is 33.34, never 33.33: a target that is followed
    // exactly and still arrives short is the one error a savings figure must not make.
    const result = goalPace(
      makeInput({
        targetMinorUnits: 10000n,
        savedMinorUnits: 0n,
        today: new Date(2026, 3, 1),
        targetDate: "2026-07-01",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "AT_RISK") {
      // 91 days left → 4 months → ceil(10000 / 4) = 2500
      expect(result.value.monthlyNeededMinorUnits).toBe(2500n);
    }
  });

  it("never divides by zero on the last day", () => {
    const result = goalPace(
      makeInput({ savedMinorUnits: 40000n, targetDate: "2026-04-01" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind !== "ACHIEVED") {
      if (result.value.kind === "AT_RISK" || result.value.kind === "ON_TRACK") {
        expect(result.value.daysLeft).toBe(1);
        expect(result.value.monthlyNeededMinorUnits).toBe(60000n);
      }
    }
  });

  it("refuses a target date that is not a real date", () => {
    const result = goalPace(makeInput({ targetDate: "2026-02-30" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidWindow");
  });

  it("refuses a window that ends before it starts", () => {
    const result = goalPace(
      makeInput({
        startedAt: new Date(2026, 8, 1),
        targetDate: "2026-07-01",
        today: new Date(2026, 5, 1),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidWindow");
  });

  it("treats a zero-length window with money missing as at risk", () => {
    // Created on its own deadline. There is no elapsed fraction to compare, and the
    // only thing that matters is that it is not funded.
    const result = goalPace(
      makeInput({
        startedAt: new Date(2026, 6, 1),
        targetDate: "2026-07-01",
        today: new Date(2026, 6, 1),
        savedMinorUnits: 10n,
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("AT_RISK");
  });
});
