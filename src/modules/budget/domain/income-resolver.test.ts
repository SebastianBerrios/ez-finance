// income-resolver.test.ts — TDD-RED for resolveIncome
// Tests: REQ-E-04 (mayor), REQ-E-05 (real), REQ-E-06 (esperado)
// §5.6 rules 1–4 fully covered.

import { describe, expect, it } from "vitest";
import type { BudgetConfig, MonthlySnapshot, SnapshotTransaction } from "@shared/domain/budget-types";
import { fromMinorUnits, equals } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { resolveIncome } from "./income-resolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usd(n: bigint) {
  return expectOk(fromMinorUnits("USD", n));
}

function makeSnapshot(txs: SnapshotTransaction[]): MonthlySnapshot {
  return {
    year: 2025,
    month: 1,
    baseCurrency: expectOk(fromMinorUnits("USD", 0n)).currency,
    transactions: txs,
    categories: [],
    accounts: [],
  };
}

function makeConfig(
  incomeMode: BudgetConfig["incomeMode"],
  expectedIncomeCents: bigint,
): BudgetConfig {
  return {
    incomeMode,
    expectedIncome: usd(expectedIncomeCents),
    percentages: { need: 50, want: 30, save: 20 },
  };
}

function incomeTx(id: string, cents: bigint): SnapshotTransaction {
  return {
    id,
    kind: "income",
    amount: usd(cents),
    date: "2025-01-15",
    accountId: "acc-1",
  };
}

function expenseTx(id: string, cents: bigint): SnapshotTransaction {
  return {
    id,
    kind: "expense",
    amount: usd(cents),
    date: "2025-01-15",
    accountId: "acc-2",
    categoryId: "cat-1",
  };
}

// ---------------------------------------------------------------------------
// incomeMode: real
// ---------------------------------------------------------------------------

describe("resolveIncome — mode: real", () => {
  it("returns sum of income transactions", () => {
    const snapshot = makeSnapshot([
      incomeTx("t1", 100000n), // $1000
      incomeTx("t2", 50000n),  // $500
    ]);
    const config = makeConfig("real", 200000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(150000n))).toBe(true);
  });

  it("ignores expense transactions — only income kind counted", () => {
    const snapshot = makeSnapshot([
      incomeTx("t1", 100000n),
      expenseTx("e1", 30000n), // should not be counted
    ]);
    const config = makeConfig("real", 200000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(100000n))).toBe(true);
  });

  it("§5.6 rule 3: returns zero when no income transactions exist", () => {
    const snapshot = makeSnapshot([expenseTx("e1", 50000n)]);
    const config = makeConfig("real", 100000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(0n))).toBe(true);
  });

  it("returns zero for empty snapshot (real mode, zero income)", () => {
    const snapshot = makeSnapshot([]);
    const config = makeConfig("real", 100000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(0n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// incomeMode: esperado
// ---------------------------------------------------------------------------

describe("resolveIncome — mode: esperado", () => {
  it("§5.6 rule 4: always returns expectedIncome regardless of real income", () => {
    const snapshot = makeSnapshot([
      incomeTx("t1", 500000n), // real = $5000
    ]);
    const config = makeConfig("esperado", 100000n); // expected = $1000
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(100000n))).toBe(true);
  });

  it("returns expectedIncome even when real income is zero", () => {
    const snapshot = makeSnapshot([]);
    const config = makeConfig("esperado", 200000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(200000n))).toBe(true);
  });

  it("returns zero expectedIncome when config.expectedIncome is zero", () => {
    const snapshot = makeSnapshot([incomeTx("t1", 100000n)]);
    const config = makeConfig("esperado", 0n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(0n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// incomeMode: mayor
// ---------------------------------------------------------------------------

describe("resolveIncome — mode: mayor", () => {
  it("§5.6 rule 1: uses expectedIncome when real < expected (start of month)", () => {
    // real = 0, expected = 1000 → mayor = 1000
    const snapshot = makeSnapshot([]);
    const config = makeConfig("mayor", 100000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(100000n))).toBe(true);
  });

  it("§5.6 rule 2: uses realIncome when real > expected (bonus month)", () => {
    // real = 1200, expected = 1000 → mayor = 1200
    const snapshot = makeSnapshot([
      incomeTx("t1", 120000n),
    ]);
    const config = makeConfig("mayor", 100000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(120000n))).toBe(true);
  });

  it("uses expectedIncome when real === expected (tie goes to either; both equal)", () => {
    const snapshot = makeSnapshot([incomeTx("t1", 100000n)]);
    const config = makeConfig("mayor", 100000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(100000n))).toBe(true);
  });

  it("sums multiple income transactions before comparing to expected", () => {
    // real = 600 + 500 = 1100, expected = 1000 → mayor = 1100
    const snapshot = makeSnapshot([
      incomeTx("t1", 60000n),
      incomeTx("t2", 50000n),
    ]);
    const config = makeConfig("mayor", 100000n);
    const result = resolveIncome(snapshot, config);
    expect(equals(result, usd(110000n))).toBe(true);
  });
});
