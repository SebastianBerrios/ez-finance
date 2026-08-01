import { describe, expect, it } from "vitest";

import type {
  MonthlySnapshot,
  SnapshotTransaction,
} from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

import { monthlyReport } from "./monthly-report";

const soles = (minor: bigint) => expectOk(fromMinorUnits("PEN", minor));

function snapshot(
  transactions: readonly SnapshotTransaction[],
): MonthlySnapshot {
  return {
    year: 2026,
    month: 8,
    baseCurrency: soles(0n).currency,
    transactions,
    categories: [
      { id: "need-1", bucket: "need", archived: false },
      { id: "need-2", bucket: "need", archived: true },
      { id: "want-1", bucket: "want", archived: false },
      { id: "save-1", bucket: "save", archived: false },
      { id: "loose", bucket: null, archived: false },
    ],
    accounts: [
      { id: "acc-1", type: "cash" },
      { id: "acc-savings", type: "savings" },
    ],
  };
}

function expense(
  id: string,
  minor: bigint,
  categoryId?: string,
): SnapshotTransaction {
  const base = {
    id,
    kind: "expense" as const,
    amount: soles(minor),
    date: "2026-08-10",
    accountId: "acc-1",
  };
  return categoryId === undefined ? base : { ...base, categoryId };
}

describe("monthlyReport", () => {
  it("totals income and expense separately", () => {
    const report = monthlyReport(
      snapshot([
        {
          id: "i1",
          kind: "income",
          amount: soles(500000n),
          date: "2026-08-01",
          accountId: "acc-1",
        },
        expense("e1", 15050n, "need-1"),
        expense("e2", 4950n, "want-1"),
      ]),
    );

    expect(report.income.minorUnits).toBe(500000n);
    expect(report.expense.minorUnits).toBe(20000n);
  });

  it("groups spending by bucket", () => {
    const report = monthlyReport(
      snapshot([
        expense("e1", 10000n, "need-1"),
        expense("e2", 5000n, "need-2"),
        expense("e3", 3000n, "want-1"),
      ]),
    );

    expect(report.byBucket.need.minorUnits).toBe(15000n);
    expect(report.byBucket.want.minorUnits).toBe(3000n);
    expect(report.byBucket.save.minorUnits).toBe(0n);
  });

  it("counts spending on ARCHIVED categories", () => {
    // The engine's rule, and the reason archiving is not deleting: a month that
    // already spent on a category keeps that spending when someone tidies up later.
    // A report that hid it would disagree with the dashboard about the same month.
    const report = monthlyReport(snapshot([expense("e1", 7000n, "need-2")]));

    expect(report.byBucket.need.minorUnits).toBe(7000n);
    expect(report.byCategory[0]?.categoryId).toBe("need-2");
  });

  it("keeps uncategorised spending visible instead of dropping it", () => {
    // It belongs to no bucket, which is exactly why it has to be shown: money that
    // left an account and appears in none of the three cubes is the difference
    // people notice and cannot explain.
    const report = monthlyReport(
      snapshot([expense("e1", 9000n), expense("e2", 1000n, "need-1")]),
    );

    expect(report.expense.minorUnits).toBe(10000n);
    expect(report.unbucketed.minorUnits).toBe(9000n);
    expect(
      report.byCategory.some((row) => row.categoryId === null),
      "uncategorised spending gets its own row",
    ).toBe(true);
  });

  it("counts a category with a bucket but no bucket total as its own bucket", () => {
    const report = monthlyReport(snapshot([expense("e1", 2500n, "loose")]));

    // 'loose' has bucket null, so it is unbucketed even though it IS a category.
    expect(report.unbucketed.minorUnits).toBe(2500n);
    expect(report.byBucket.need.minorUnits).toBe(0n);
  });

  it("EXCLUDES transfers from spending", () => {
    // A transfer is money moving between your own accounts. Counting it as an
    // expense would report you spending every time you moved savings around — the
    // same rule the engine applies, and a report that disagreed with the dashboard
    // about the same month would be worse than no report.
    const report = monthlyReport(
      snapshot([
        expense("e1", 5000n, "need-1"),
        {
          id: "t-out",
          kind: "transfer",
          amount: soles(100000n),
          date: "2026-08-05",
          accountId: "acc-1",
          transferId: "tr-1",
          transferLeg: "out",
          counterAccountId: "acc-savings",
        },
        {
          id: "t-in",
          kind: "transfer",
          amount: soles(100000n),
          date: "2026-08-05",
          accountId: "acc-savings",
          transferId: "tr-1",
          transferLeg: "in",
          counterAccountId: "acc-1",
        },
      ]),
    );

    expect(report.expense.minorUnits).toBe(5000n);
    expect(report.income.minorUnits).toBe(0n);
  });

  it("sorts categories by amount, biggest first", () => {
    // The question is "where did it go", so the answer leads with the biggest.
    const report = monthlyReport(
      snapshot([
        expense("e1", 1000n, "need-1"),
        expense("e2", 9000n, "want-1"),
        expense("e3", 5000n, "save-1"),
      ]),
    );

    expect(report.byCategory.map((row) => row.categoryId)).toEqual([
      "want-1",
      "save-1",
      "need-1",
    ]);
  });

  it("returns zeroes rather than nothing for an empty month", () => {
    // A month with no movements is a real answer. Rendering "no data" for it would
    // make an empty month indistinguishable from a failed read.
    const report = monthlyReport(snapshot([]));

    expect(report.income.minorUnits).toBe(0n);
    expect(report.expense.minorUnits).toBe(0n);
    expect(report.byBucket.need.minorUnits).toBe(0n);
    expect(report.byCategory).toEqual([]);
  });

  it("carries the snapshot's currency into every total", () => {
    const report = monthlyReport(snapshot([expense("e1", 100n, "need-1")]));

    expect(report.expense.currency).toBe("PEN");
    expect(report.byBucket.save.currency).toBe("PEN");
  });
});
