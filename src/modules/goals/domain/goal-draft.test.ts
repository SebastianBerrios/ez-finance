import { describe, expect, it } from "vitest";

import { goalDraft, NAME_MAX } from "./goal-draft";

const VALID = {
  name: "Viaje",
  accountId: "acc-1",
  targetAmountMinorUnits: 200000n,
};

describe("goalDraft", () => {
  it("accepts a name, an account and a positive target", () => {
    const result = goalDraft(VALID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: "Viaje",
        accountId: "acc-1",
        targetAmountMinorUnits: 200000n,
      });
    }
  });

  it("trims the name", () => {
    const result = goalDraft({ ...VALID, name: "  Viaje  " });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Viaje");
  });

  it("refuses an empty name", () => {
    for (const name of ["", "   "]) {
      const result = goalDraft({ ...VALID, name });
      expect(result.ok, `"${name}" must be refused`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("NameRequired");
    }
  });

  it("refuses a name past the column limit", () => {
    const result = goalDraft({ ...VALID, name: "a".repeat(NAME_MAX + 1) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameTooLong");
  });

  it("refuses a target of zero", () => {
    // Not pedantry: a goal of zero is REACHED the moment it is created, so it would
    // render as complete before anyone saved anything.
    const result = goalDraft({ ...VALID, targetAmountMinorUnits: 0n });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("TargetNotPositive");
  });

  it("refuses a negative target", () => {
    const result = goalDraft({ ...VALID, targetAmountMinorUnits: -100n });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("TargetNotPositive");
  });

  it("requires an account, because the account IS the progress", () => {
    // There is no stored saved_amount; a goal with no account could never report
    // anything, so it is refused rather than created as a permanent zero.
    const result = goalDraft({ ...VALID, accountId: "  " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AccountRequired");
  });

  it("accepts an optional target date and keeps it", () => {
    const result = goalDraft({ ...VALID, targetDate: "2026-12-31" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetDate).toBe("2026-12-31");
  });

  it("OMITS the date rather than storing an empty one", () => {
    // exactOptionalPropertyTypes is on, and an empty <input type=date> submits "".
    // A goal without a date is a direction rather than a commitment — both are valid,
    // and the difference must survive into storage.
    const result = goalDraft({ ...VALID, targetDate: "" });

    expect(result.ok).toBe(true);
    if (result.ok) expect("targetDate" in result.value).toBe(false);
  });

  it("refuses a date that is not YYYY-MM-DD", () => {
    for (const targetDate of ["31/12/2026", "2026-13-01", "mañana"]) {
      const result = goalDraft({ ...VALID, targetDate });
      expect(result.ok, `"${targetDate}" must be refused`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidDate");
    }
  });

  it("reports the NAME problem first when several are wrong", () => {
    const result = goalDraft({
      name: "",
      accountId: "",
      targetAmountMinorUnits: 0n,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameRequired");
  });
});
