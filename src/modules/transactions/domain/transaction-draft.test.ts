import { describe, expect, it } from "vitest";

import { transactionDraft } from "./transaction-draft";

const VALID = {
  kind: "expense",
  baseAmountMinorUnits: 2500n,
  occurredOn: "2026-07-15",
  accountId: "acc-1",
  categoryId: "cat-1",
  note: "Almuerzo",
} as const;

describe("transactionDraft.create", () => {
  it("accepts a well-formed expense", () => {
    const result = transactionDraft.create(VALID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("expense");
      expect(result.value.baseAmountMinorUnits).toBe(2500n);
      expect(result.value.occurredOn).toBe("2026-07-15");
      expect(result.value.categoryId).toBe("cat-1");
    }
  });

  it("accepts an income", () => {
    expect(transactionDraft.create({ ...VALID, kind: "income" }).ok).toBe(true);
  });

  it("REJECTS a transfer", () => {
    // A transfer is a tied PAIR of rows and cannot be expressed as one draft.
    // ez_finance.record_transfer() writes both legs; RLS refuses a lone one. Being
    // rejected here rather than at the database is the difference between a form
    // error and a policy violation nobody can read.
    const result = transactionDraft.create({ ...VALID, kind: "transfer" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidKind");
  });

  it("rejects a kind that is not a kind", () => {
    const result = transactionDraft.create({ ...VALID, kind: "regalo" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidKind");
  });

  it.each([0n, -1n, -2500n])("rejects a non-positive amount (%s)", (amount) => {
    // The sign comes from `kind`, never from the number — base_amount has a
    // CHECK (> 0) for the same reason, and a zero movement is not a movement.
    const result = transactionDraft.create({
      ...VALID,
      baseAmountMinorUnits: amount,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAmount");
  });

  it.each(["", "15/07/2026", "2026-7-5", "2026-13-01", "2026-02-30", "hoy"])(
    "rejects a date that is not a real YYYY-MM-DD (%j)",
    (occurredOn) => {
      const result = transactionDraft.create({ ...VALID, occurredOn });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidDate");
    },
  );

  it("accepts a leap day that exists", () => {
    expect(
      transactionDraft.create({ ...VALID, occurredOn: "2028-02-29" }).ok,
    ).toBe(true);
  });

  it("rejects a leap day that does not", () => {
    // 2026 is not a leap year. A regex alone would let this through, which is why
    // the check round-trips through a real date.
    const result = transactionDraft.create({
      ...VALID,
      occurredOn: "2026-02-29",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidDate");
  });

  it("rejects a blank account", () => {
    const result = transactionDraft.create({ ...VALID, accountId: "  " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AccountRequired");
  });

  it("omits categoryId when none is given, rather than storing undefined", () => {
    // exactOptionalPropertyTypes is on, and the engine treats an ABSENT categoryId
    // differently from a present one — an uncategorised expense is counted per
    // category and in NO bucket.
    const result = transactionDraft.create({
      kind: "expense",
      baseAmountMinorUnits: 100n,
      occurredOn: "2026-07-15",
      accountId: "acc-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect("categoryId" in result.value).toBe(false);
  });

  it("treats a blank category as no category", () => {
    // An unselected <select> submits "", which is not a category id.
    const result = transactionDraft.create({ ...VALID, categoryId: "" });

    expect(result.ok).toBe(true);
    if (result.ok) expect("categoryId" in result.value).toBe(false);
  });

  it("trims the note and drops it when empty", () => {
    const result = transactionDraft.create({ ...VALID, note: "   " });

    expect(result.ok).toBe(true);
    if (result.ok) expect("note" in result.value).toBe(false);
  });

  it("rejects a note longer than the column allows", () => {
    const result = transactionDraft.create({ ...VALID, note: "x".repeat(501) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NoteTooLong");
  });
});
