import { describe, expect, it } from "vitest";

import { NAME_MAX, NOTE_MAX, scheduledDraft } from "./scheduled-draft";

const VALID = {
  name: "Alquiler",
  kind: "expense",
  accountId: "acc-1",
  amountMinorUnits: 150000n,
  dayOfMonth: 1,
};

describe("scheduledDraft", () => {
  it("accepts a complete schedule", () => {
    const result = scheduledDraft(VALID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alquiler");
      expect(result.value.kind).toBe("expense");
      expect(result.value.dayOfMonth).toBe(1);
    }
  });

  it("REFUSES a transfer", () => {
    // The rule most worth pinning. A transfer is a tied PAIR written by
    // record_transfer(); a scheduler that produced one leg would corrupt the invariant
    // the whole transfers design exists to protect.
    const result = scheduledDraft({ ...VALID, kind: "transfer" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidKind");
  });

  it("refuses a kind that is not income or expense", () => {
    for (const kind of ["", "gasto", "INCOME"]) {
      const result = scheduledDraft({ ...VALID, kind });
      expect(result.ok, `"${kind}" must be refused`).toBe(false);
    }
  });

  it("refuses a non-positive amount", () => {
    for (const amountMinorUnits of [0n, -1n]) {
      const result = scheduledDraft({ ...VALID, amountMinorUnits });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("AmountNotPositive");
    }
  });

  it("refuses a day outside 1–31", () => {
    for (const dayOfMonth of [0, 32, -1, 1.5]) {
      const result = scheduledDraft({ ...VALID, dayOfMonth });
      expect(result.ok, `${dayOfMonth} must be refused`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidDay");
    }
  });

  it("ACCEPTS day 31 without clamping it", () => {
    // Clamping is the database's job, so that "the 31st" means the end of EVERY month
    // rather than whatever the month of creation happened to allow.
    const result = scheduledDraft({ ...VALID, dayOfMonth: 31 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dayOfMonth).toBe(31);
  });

  it("omits an empty category rather than storing one", () => {
    const result = scheduledDraft({ ...VALID, categoryId: "" });

    expect(result.ok).toBe(true);
    if (result.ok) expect("categoryId" in result.value).toBe(false);
  });

  it("keeps a category that was chosen", () => {
    const result = scheduledDraft({ ...VALID, categoryId: " cat-1 " });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.categoryId).toBe("cat-1");
  });

  it("refuses a note past the column limit", () => {
    const result = scheduledDraft({ ...VALID, note: "a".repeat(NOTE_MAX + 1) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NoteTooLong");
  });

  it("refuses an empty name and one past the limit", () => {
    expect(scheduledDraft({ ...VALID, name: "  " }).ok).toBe(false);
    expect(
      scheduledDraft({ ...VALID, name: "a".repeat(NAME_MAX + 1) }).ok,
    ).toBe(false);
  });

  it("requires an account", () => {
    const result = scheduledDraft({ ...VALID, accountId: " " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AccountRequired");
  });
});
