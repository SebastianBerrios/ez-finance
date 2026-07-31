// budget-engine.test.ts — TDD: computeBudget integration tests
// Covers all §5.6 scenarios end-to-end (REQ-G-02 coverage requirement)
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import { describe, expect, it } from "vitest";
import type {
  BudgetConfig,
  MonthlySnapshot,
  SnapshotAccount,
  SnapshotCategory,
  SnapshotTransaction,
} from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { computeBudget } from "./budget-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usd(n: bigint) {
  return expectOk(fromMinorUnits("USD", n));
}

const BASE_ACCOUNTS: SnapshotAccount[] = [
  { id: "bank-1", type: "bank" },
  { id: "bank-2", type: "bank" },
  { id: "savings-1", type: "savings" },
  { id: "savings-2", type: "savings" },
];

const BASE_CATEGORIES: SnapshotCategory[] = [
  { id: "cat-need", bucket: "need", archived: false },
  { id: "cat-want", bucket: "want", archived: false },
  { id: "cat-save", bucket: "save", archived: false },
];

function makeSnapshot(
  transactions: SnapshotTransaction[],
  overrides?: {
    categories?: SnapshotCategory[];
    accounts?: SnapshotAccount[];
  },
): MonthlySnapshot {
  return {
    year: 2024,
    month: 1,
    baseCurrency: expectOk(fromMinorUnits("USD", 0n)).currency,
    transactions,
    categories: overrides?.categories ?? BASE_CATEGORIES,
    accounts: overrides?.accounts ?? BASE_ACCOUNTS,
  };
}

function makeConfig(overrides?: Partial<BudgetConfig>): BudgetConfig {
  return {
    incomeMode: "real",
    expectedIncome: usd(100000n), // $1000.00
    percentages: { need: 50, want: 30, save: 20 },
    nearLimitThresholdPct: 80,
    ...overrides,
  };
}

function incomeTransaction(amount: bigint): SnapshotTransaction {
  return {
    id: "income-1",
    kind: "income",
    amount: usd(amount),
    date: "2024-01-15",
    accountId: "bank-1",
  };
}

function expenseTransaction(
  id: string,
  amount: bigint,
  categoryId: string,
  accountId = "bank-1",
): SnapshotTransaction {
  return {
    id,
    kind: "expense",
    amount: usd(amount),
    date: "2024-01-15",
    accountId,
    categoryId,
  };
}

function transferPair(
  outAccountId: string,
  inAccountId: string,
  amount: bigint,
  transferId = "transfer-1",
): SnapshotTransaction[] {
  return [
    {
      id: `${transferId}-out`,
      kind: "transfer",
      amount: usd(amount),
      date: "2024-01-15",
      accountId: outAccountId,
      transferId,
      transferLeg: "out",
      counterAccountId: inAccountId,
    },
    {
      id: `${transferId}-in`,
      kind: "transfer",
      amount: usd(amount),
      date: "2024-01-15",
      accountId: inAccountId,
      transferId,
      transferLeg: "in",
      counterAccountId: outAccountId,
    },
  ];
}

// ---------------------------------------------------------------------------
// §5.6 Rule 1/2 — Income mode: mayor
// REQ-E-04: uses max(realIncome, expectedIncome)
// ---------------------------------------------------------------------------

describe("§5.6 rule 1/2 — income mode: mayor", () => {
  it("rule 1: uses expectedIncome when real < expected (start of month)", () => {
    // real = $0, expected = $1000 → effective = $1000
    const snapshot = makeSnapshot([]);
    const config = makeConfig({
      incomeMode: "mayor",
      expectedIncome: usd(100000n),
    });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.incomeUsed.minorUnits).toBe(100000n); // expected wins
    expect(result.buckets.need.targetAmount.minorUnits).toBe(50000n); // 50% of $1000
  });

  it("rule 2: uses realIncome when real > expected (bonus month)", () => {
    // real = $1200, expected = $1000 → effective = $1200
    const snapshot = makeSnapshot([incomeTransaction(120000n)]); // $1200
    const config = makeConfig({
      incomeMode: "mayor",
      expectedIncome: usd(100000n),
    });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.incomeUsed.minorUnits).toBe(120000n); // real wins
    expect(result.buckets.need.targetAmount.minorUnits).toBe(60000n); // 50% of $1200
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 3 — Income mode: real (zero income → 0%)
// REQ-E-05, REQ-E-08
// ---------------------------------------------------------------------------

describe("§5.6 rule 3 — income mode: real, zero income", () => {
  it("shows 0% everywhere when no income transactions and mode=real", () => {
    const snapshot = makeSnapshot([]);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.incomeUsed.minorUnits).toBe(0n);
    expect(result.buckets.need.consumedPct).toBe(0);
    expect(result.buckets.want.consumedPct).toBe(0);
    expect(result.buckets.save.consumedPct).toBe(0);
    expect(Number.isNaN(result.buckets.need.consumedPct)).toBe(false);
    expect(Number.isNaN(result.buckets.want.consumedPct)).toBe(false);
    expect(Number.isNaN(result.buckets.save.consumedPct)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 4 — Income mode: esperado
// REQ-E-06
// ---------------------------------------------------------------------------

describe("§5.6 rule 4 — income mode: esperado", () => {
  it("always uses expectedIncome regardless of real income", () => {
    // real = $5000, expected = $1000 → effective = $1000 (esperado always wins)
    const snapshot = makeSnapshot([incomeTransaction(500000n)]); // $5000 real
    const config = makeConfig({
      incomeMode: "esperado",
      expectedIncome: usd(100000n),
    });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.incomeUsed.minorUnits).toBe(100000n); // expected, not real
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rules 5–8 — Transfer matrix
// REQ-E-10..13
// ---------------------------------------------------------------------------

describe("§5.6 rule 5 — transfer: operational → operational, neutral", () => {
  it("does not count op→op transfer in any bucket", () => {
    const transactions = [
      incomeTransaction(100000n), // $1000 income
      ...transferPair("bank-1", "bank-2", 20000n), // op→op: neutral
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.savingsAmount.minorUnits).toBe(0n);
    expect(result.buckets.save.consumedAmount.minorUnits).toBe(0n);
    expect(result.buckets.need.consumedAmount.minorUnits).toBe(0n);
  });
});

describe("§5.6 rule 6 — transfer: operational → savings, consumes save bucket", () => {
  it("counts out-leg of op→savings transfer in save bucket", () => {
    const transactions = [
      incomeTransaction(100000n),
      ...transferPair("bank-1", "savings-1", 20000n), // op→savings
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({
      incomeMode: "real",
      percentages: { need: 50, want: 30, save: 20 },
    });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.savingsAmount.minorUnits).toBe(20000n); // $200 = 20% of $1000
    expect(result.buckets.save.consumedAmount.minorUnits).toBe(20000n);
    expect(result.buckets.save.consumedPct).toBeCloseTo(20, 5);
    // Need and want buckets untouched
    expect(result.buckets.need.consumedAmount.minorUnits).toBe(0n);
    expect(result.buckets.want.consumedAmount.minorUnits).toBe(0n);
  });
});

describe("§5.6 rule 7 — transfer: savings → savings, neutral", () => {
  it("does not count sav→sav transfer in any bucket", () => {
    const transactions = [
      incomeTransaction(100000n),
      ...transferPair("savings-1", "savings-2", 50000n), // sav→sav: neutral
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.savingsAmount.minorUnits).toBe(0n);
    expect(result.buckets.save.consumedAmount.minorUnits).toBe(0n);
  });
});

describe("§5.6 rule 8 — transfer: savings → operational, neutral", () => {
  it("does not count sav→op transfer (withdrawal does not reverse prior contributions)", () => {
    const transactions = [
      incomeTransaction(100000n),
      ...transferPair("savings-1", "bank-1", 30000n), // sav→op: neutral
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.savingsAmount.minorUnits).toBe(0n);
    expect(result.buckets.save.consumedAmount.minorUnits).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 9 — Savings additive: save-bucket expenses + op→savings transfers
// REQ-E-14
// ---------------------------------------------------------------------------

describe("§5.6 rule 9 — savings: additive (save-bucket expenses + transfer inflow)", () => {
  it("sums save-bucket expense and op→savings transfer", () => {
    const transactions = [
      incomeTransaction(100000n),
      expenseTransaction("save-exp", 10000n, "cat-save"), // $100 save-bucket expense
      ...transferPair("bank-1", "savings-1", 15000n), // $150 transfer to savings
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    // savingsAmount = 100 + 150 = 250
    expect(result.savingsAmount.minorUnits).toBe(25000n); // $250
    expect(result.buckets.save.consumedAmount.minorUnits).toBe(25000n);
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 10 — Archived category still counts
// REQ-E-15
// ---------------------------------------------------------------------------

describe("§5.6 rule 10 — archived category still counts", () => {
  it("includes expenses from archived categories in their bucket", () => {
    const archivedCat: SnapshotCategory = {
      id: "archived-need",
      bucket: "need",
      archived: true,
    };
    const categories = [...BASE_CATEGORIES, archivedCat];
    const transactions = [
      incomeTransaction(100000n),
      expenseTransaction("exp-archived", 15000n, "archived-need"),
    ];
    const snapshot = makeSnapshot(transactions, { categories });
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    expect(result.buckets.need.consumedAmount.minorUnits).toBe(15000n);
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 11 — Unknown category silently ignored
// REQ-E-16
// ---------------------------------------------------------------------------

describe("§5.6 rule 11 — unknown category silently ignored", () => {
  it("ignores transactions with categoryId not in snapshot.categories", () => {
    const transactions = [
      incomeTransaction(100000n),
      expenseTransaction("exp-unknown", 9999n, "nonexistent-category"),
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    // Unknown category is silently ignored — no buckets consumed
    expect(result.buckets.need.consumedAmount.minorUnits).toBe(0n);
    expect(result.buckets.want.consumedAmount.minorUnits).toBe(0n);
    expect(result.buckets.save.consumedAmount.minorUnits).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 12 — Zero income (both expected=0 and real=0)
// REQ-E-08
// ---------------------------------------------------------------------------

describe("§5.6 rule 12 — zero income: all 0%, no NaN, Result.ok", () => {
  it("returns Result.ok with all 0% and zero targets when both incomes are zero", () => {
    const snapshot = makeSnapshot([]); // no income transactions
    const config = makeConfig({
      incomeMode: "real",
      expectedIncome: usd(0n), // expected income = 0
    });

    const result = computeBudget(snapshot, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.incomeUsed.minorUnits).toBe(0n);
    expect(result.value.buckets.need.targetAmount.minorUnits).toBe(0n);
    expect(result.value.buckets.want.targetAmount.minorUnits).toBe(0n);
    expect(result.value.buckets.save.targetAmount.minorUnits).toBe(0n);
    expect(result.value.buckets.need.consumedPct).toBe(0);
    expect(result.value.buckets.want.consumedPct).toBe(0);
    expect(result.value.buckets.save.consumedPct).toBe(0);
    expect(Number.isNaN(result.value.buckets.need.consumedPct)).toBe(false);
    expect(Number.isNaN(result.value.buckets.want.consumedPct)).toBe(false);
    expect(Number.isNaN(result.value.buckets.save.consumedPct)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 13 — Percentages not summing to 100 → ConfigError
// REQ-E-02
// ---------------------------------------------------------------------------

describe("§5.6 rule 13 — percentages not summing to 100 → ConfigError", () => {
  it("returns Result.err(ConfigError, percentages-not-100) when sum !== 100", () => {
    const snapshot = makeSnapshot([]);
    const config = makeConfig({
      percentages: { need: 50, want: 30, save: 25 },
    }); // sum = 105

    const result = computeBudget(snapshot, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ConfigError");
    expect(result.error.reason).toBe("percentages-not-100");
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rule 14 — Negative percentage → ConfigError
// REQ-E-02
// ---------------------------------------------------------------------------

describe("§5.6 rule 14 — negative percentage → ConfigError", () => {
  it("returns Result.err(ConfigError, percentage-negative) for negative bucket", () => {
    const snapshot = makeSnapshot([]);
    const config = makeConfig({
      percentages: { need: 60, want: 60, save: -20 },
    });

    const result = computeBudget(snapshot, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ConfigError");
    expect(result.error.reason).toBe("percentage-negative");
  });
});

// ---------------------------------------------------------------------------
// §5.6 Rules 15/16 — Near-limit and over-limit alerts
// REQ-E-18 + locked edge cases
// ---------------------------------------------------------------------------

describe("§5.6 rules 15/16 — alert thresholds", () => {
  it("rule 15: emits near-limit alert when bucket is at threshold (80%) of income", () => {
    // income = $1000, need consumed = $800 = 80% of income
    const transactions = [
      incomeTransaction(100000n),
      expenseTransaction("need-exp", 80000n, "cat-need"),
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({
      incomeMode: "real",
      nearLimitThresholdPct: 80,
    });

    const result = expectOk(computeBudget(snapshot, config));

    const needAlert = result.alerts.find(
      (a) => a.scope === "bucket" && a.bucket === "need",
    );
    expect(needAlert).toBeDefined();
    expect(needAlert?.level).toBe("near");
  });

  it("rule 16: emits over-limit alert when bucket exceeds 100% of income", () => {
    // income = $1000, need consumed = $1100 = 110% of income
    const transactions = [
      incomeTransaction(100000n),
      expenseTransaction("need-exp", 110000n, "cat-need"),
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    const needAlert = result.alerts.find(
      (a) => a.scope === "bucket" && a.bucket === "need",
    );
    expect(needAlert).toBeDefined();
    expect(needAlert?.level).toBe("over");
  });

  it("locked: at exactly 100% → ONLY near-limit alert (not over)", () => {
    // income = $1000, need consumed = $1000 = exactly 100% of income
    const transactions = [
      incomeTransaction(100000n),
      expenseTransaction("need-exp", 100000n, "cat-need"),
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({
      incomeMode: "real",
      nearLimitThresholdPct: 80,
    });

    const result = expectOk(computeBudget(snapshot, config));

    const overAlerts = result.alerts.filter(
      (a) => a.bucket === "need" && a.level === "over",
    );
    const nearAlerts = result.alerts.filter(
      (a) => a.bucket === "need" && a.level === "near",
    );
    expect(overAlerts).toHaveLength(0);
    expect(nearAlerts).toHaveLength(1);
  });

  it("locked: at >100% → ONLY over-limit alert (not near+over)", () => {
    // income = $1000, need consumed = $1010 = 101% of income
    const transactions = [
      incomeTransaction(100000n),
      expenseTransaction("need-exp", 101000n, "cat-need"),
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({
      incomeMode: "real",
      nearLimitThresholdPct: 80,
    });

    const result = expectOk(computeBudget(snapshot, config));

    const overAlerts = result.alerts.filter(
      (a) => a.bucket === "need" && a.level === "over",
    );
    const nearAlerts = result.alerts.filter(
      (a) => a.bucket === "need" && a.level === "near",
    );
    expect(overAlerts).toHaveLength(1);
    expect(nearAlerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BudgetResult structure: globalAvailable, savingsAmount
// REQ-E-09
// ---------------------------------------------------------------------------

describe("BudgetResult: globalAvailable", () => {
  it("globalAvailable = income - sum(all bucket consumed amounts)", () => {
    const transactions = [
      incomeTransaction(100000n), // $1000 income
      expenseTransaction("need-exp", 40000n, "cat-need"), // $400 need
      expenseTransaction("want-exp", 20000n, "cat-want"), // $200 want
      expenseTransaction("save-exp", 10000n, "cat-save"), // $100 save
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    // totalConsumed = 400 + 200 + 100 = 700
    // globalAvailable = 1000 - 700 = 300
    expect(result.globalAvailable.minorUnits).toBe(30000n);
  });

  it("globalAvailable can be negative when total consumed exceeds income", () => {
    const transactions = [
      incomeTransaction(100000n), // $1000 income
      expenseTransaction("need-exp", 120000n, "cat-need"), // $1200 need (over budget!)
    ];
    const snapshot = makeSnapshot(transactions);
    const config = makeConfig({ incomeMode: "real" });

    const result = expectOk(computeBudget(snapshot, config));

    // globalAvailable = 1000 - 1200 = -200
    expect(result.globalAvailable.minorUnits).toBe(-20000n);
  });
});

// ---------------------------------------------------------------------------
// Income currency mismatch guard
// REQ-E-01 (orchestrator currency check)
// ---------------------------------------------------------------------------

describe("income currency mismatch", () => {
  it("returns Result.err(ConfigError, income-currency-mismatch) when expectedIncome currency differs from baseCurrency", () => {
    const eurIncome = expectOk(fromMinorUnits("EUR", 100000n));
    const snapshot = makeSnapshot([]); // baseCurrency = USD
    const config = makeConfig({ expectedIncome: eurIncome }); // EUR vs USD snapshot

    const result = computeBudget(snapshot, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ConfigError");
    expect(result.error.reason).toBe("income-currency-mismatch");
  });
});

// ---------------------------------------------------------------------------
// Monetary-input currency mismatch guard (defensive, before any computation)
// A transaction amount or category-limit in a currency other than
// snapshot.baseCurrency must produce Result.err — NEVER throw.
// ---------------------------------------------------------------------------

describe("monetary-input currency mismatch", () => {
  it("returns Result.err(ConfigError, currency-mismatch) — does NOT throw — when an income transaction amount currency differs from baseCurrency", () => {
    // baseCurrency = USD, but one income tx is in EUR.
    // Before the guard, resolveIncome/classify would throw via expectOk(add(...)).
    const eurIncome: SnapshotTransaction = {
      id: "income-eur",
      kind: "income",
      amount: expectOk(fromMinorUnits("EUR", 100000n)),
      date: "2024-01-15",
      accountId: "bank-1",
    };
    const snapshot = makeSnapshot([eurIncome]); // baseCurrency USD
    const config = makeConfig({ incomeMode: "real" });

    const result = computeBudget(snapshot, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ConfigError");
    expect(result.error.reason).toBe("currency-mismatch");
  });

  it("returns Result.err(ConfigError, currency-mismatch) when an expense transaction amount currency differs from baseCurrency", () => {
    const eurExpense: SnapshotTransaction = {
      id: "exp-eur",
      kind: "expense",
      amount: expectOk(fromMinorUnits("EUR", 5000n)),
      date: "2024-01-15",
      accountId: "bank-1",
      categoryId: "cat-need",
    };
    const snapshot = makeSnapshot([eurExpense]); // baseCurrency USD
    const config = makeConfig({ incomeMode: "real" });

    const result = computeBudget(snapshot, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("currency-mismatch");
  });

  it("returns Result.err(ConfigError, currency-mismatch) when a categoryLimit currency differs from baseCurrency", () => {
    const eurLimit = expectOk(fromMinorUnits("EUR", 10000n));
    const snapshot = makeSnapshot([]); // baseCurrency USD
    const config = makeConfig({
      incomeMode: "real",
      categoryLimits: [{ categoryId: "cat-need", limit: eurLimit }],
    });

    const result = computeBudget(snapshot, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("currency-mismatch");
  });

  it("still returns ok when every monetary input matches baseCurrency (guard does not false-positive)", () => {
    const snapshot = makeSnapshot([
      incomeTransaction(100000n),
      expenseTransaction("need-exp", 40000n, "cat-need"),
    ]);
    const config = makeConfig({
      incomeMode: "real",
      categoryLimits: [{ categoryId: "cat-need", limit: usd(50000n) }],
    });

    const result = computeBudget(snapshot, config);
    expect(result.ok).toBe(true);
  });
});
