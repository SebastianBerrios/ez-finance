// transfer-classifier.test.ts — TDD-RED for classify
// Tests: 4 transfer-matrix cells, unknown-category silent ignore, archived-still-counts
// §5.6 rules 5–11 covered.

import { describe, expect, it } from "vitest";
import type {
  MonthlySnapshot,
  SnapshotTransaction,
  SnapshotCategory,
  SnapshotAccount,
} from "@shared/domain/budget-types";
import { fromMinorUnits, equals, zero } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { classify } from "./transfer-classifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usd(n: bigint) {
  return expectOk(fromMinorUnits("USD", n));
}

function zeroUsd() {
  return expectOk(zero("USD"));
}

// Use the currency from a real Money so TS is happy
const USD_CURRENCY = usd(0n).currency;

function makeSnapshot(
  txs: SnapshotTransaction[],
  cats: SnapshotCategory[],
  accounts: SnapshotAccount[],
): MonthlySnapshot {
  return {
    year: 2025,
    month: 1,
    baseCurrency: USD_CURRENCY,
    transactions: txs,
    categories: cats,
    accounts: accounts,
  };
}

function opAccount(id: string): SnapshotAccount {
  return { id, type: "bank" };
}

function savingsAccount(id: string): SnapshotAccount {
  return { id, type: "savings" };
}

function needCategory(id: string, archived = false): SnapshotCategory {
  return { id, bucket: "need", archived };
}

function wantCategory(id: string, archived = false): SnapshotCategory {
  return { id, bucket: "want", archived };
}

function saveCategory(id: string, archived = false): SnapshotCategory {
  return { id, bucket: "save", archived };
}

function incomeTx(id: string, cents: bigint): SnapshotTransaction {
  return {
    id,
    kind: "income",
    amount: usd(cents),
    date: "2025-01-15",
    accountId: "acc-op-1",
  };
}

function expenseTx(
  id: string,
  cents: bigint,
  catId: string,
): SnapshotTransaction {
  return {
    id,
    kind: "expense",
    amount: usd(cents),
    date: "2025-01-15",
    accountId: "acc-op-1",
    categoryId: catId,
  };
}

function transferPair(
  outId: string,
  inId: string,
  transferId: string,
  cents: bigint,
  outAccountId: string,
  inAccountId: string,
): [SnapshotTransaction, SnapshotTransaction] {
  const out: SnapshotTransaction = {
    id: outId,
    kind: "transfer",
    amount: usd(cents),
    date: "2025-01-15",
    accountId: outAccountId,
    transferId,
    transferLeg: "out",
    counterAccountId: inAccountId,
  };
  const inLeg: SnapshotTransaction = {
    id: inId,
    kind: "transfer",
    amount: usd(cents),
    date: "2025-01-15",
    accountId: inAccountId,
    transferId,
    transferLeg: "in",
    counterAccountId: outAccountId,
  };
  return [out, inLeg];
}

// ---------------------------------------------------------------------------
// Income classification
// ---------------------------------------------------------------------------

describe("classify — income", () => {
  it("sums all income transactions into incomeTotal", () => {
    const snapshot = makeSnapshot(
      [incomeTx("t1", 100000n), incomeTx("t2", 50000n)],
      [],
      [],
    );
    const result = classify(snapshot);
    expect(equals(result.incomeTotal, usd(150000n))).toBe(true);
  });

  it("incomeTotal is zero when no income transactions", () => {
    const snapshot = makeSnapshot([], [], []);
    const result = classify(snapshot);
    expect(equals(result.incomeTotal, zeroUsd())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Expense classification — known categories
// ---------------------------------------------------------------------------

describe("classify — expense by bucket", () => {
  it("routes need expenses to expenseByBucket.need", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 50000n, "cat-need")],
      [needCategory("cat-need")],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.need, usd(50000n))).toBe(true);
    expect(equals(result.expenseByBucket.want, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.save, zeroUsd())).toBe(true);
  });

  it("routes want expenses to expenseByBucket.want", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 30000n, "cat-want")],
      [wantCategory("cat-want")],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.want, usd(30000n))).toBe(true);
  });

  it("routes save expenses to expenseByBucket.save", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 20000n, "cat-save")],
      [saveCategory("cat-save")],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.save, usd(20000n))).toBe(true);
  });

  it("accumulates multiple expenses in the same bucket", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 30000n, "cat-need"), expenseTx("e2", 20000n, "cat-need")],
      [needCategory("cat-need")],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.need, usd(50000n))).toBe(true);
  });

  it("accumulates expenses across multiple buckets", () => {
    const snapshot = makeSnapshot(
      [
        expenseTx("e1", 50000n, "cat-need"),
        expenseTx("e2", 30000n, "cat-want"),
        expenseTx("e3", 20000n, "cat-save"),
      ],
      [needCategory("cat-need"), wantCategory("cat-want"), saveCategory("cat-save")],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.need, usd(50000n))).toBe(true);
    expect(equals(result.expenseByBucket.want, usd(30000n))).toBe(true);
    expect(equals(result.expenseByBucket.save, usd(20000n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5.6 rule 10: Archived category still counts
// ---------------------------------------------------------------------------

describe("classify — archived category still counts (§5.6 rule 10)", () => {
  it("counts expense for archived need category", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 50000n, "cat-arch")],
      [needCategory("cat-arch", true /* archived */)],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.need, usd(50000n))).toBe(true);
  });

  it("counts expense for archived want category", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 30000n, "cat-arch-want")],
      [wantCategory("cat-arch-want", true)],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.want, usd(30000n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5.6 rule 11: Unknown/nonexistent category silently ignored
// ---------------------------------------------------------------------------

describe("classify — unknown category silently ignored (§5.6 rule 11)", () => {
  it("ignores expense with categoryId not in snapshot categories", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 50000n, "cat-nonexistent")],
      [], // empty categories — 'cat-nonexistent' has no match
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.need, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.want, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.save, zeroUsd())).toBe(true);
  });

  it("ignores expense without categoryId (no categoryId field)", () => {
    // A transfer has no categoryId — but let's also test expense without it
    const tx: SnapshotTransaction = {
      id: "e1",
      kind: "expense",
      amount: usd(50000n),
      date: "2025-01-15",
      accountId: "acc-op-1",
      // categoryId intentionally omitted
    };
    const snapshot = makeSnapshot([tx], [], [opAccount("acc-op-1")]);
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.need, zeroUsd())).toBe(true);
  });

  it("only ignores the unknown category — known categories in same snapshot still count", () => {
    const snapshot = makeSnapshot(
      [
        expenseTx("e1", 50000n, "cat-known"),
        expenseTx("e2", 30000n, "cat-unknown"),
      ],
      [needCategory("cat-known")], // only cat-known is in snapshot
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.need, usd(50000n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transfer matrix — 4 cells (§5.6 rules 5–8)
// ---------------------------------------------------------------------------

describe("classify — transfer matrix", () => {
  // Cell 1: operational → savings (§5.6 rule 6) — OUT-leg amount consumed as SAVE
  it("§5.6 rule 6: operational→savings counts OUT leg in transferSavingsInflow", () => {
    const [out, inLeg] = transferPair(
      "t-out", "t-in", "transfer-1",
      20000n, // 200 USD outgoing
      "acc-bank",
      "acc-savings",
    );
    const snapshot = makeSnapshot(
      [out, inLeg],
      [],
      [opAccount("acc-bank"), savingsAccount("acc-savings")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, usd(20000n))).toBe(true);
    // Should NOT also count in expenseByBucket.save
    expect(equals(result.expenseByBucket.save, zeroUsd())).toBe(true);
  });

  // Cell 2: operational → operational (§5.6 rule 5) — neutral
  it("§5.6 rule 5: operational→operational is neutral (no bucket consumed)", () => {
    const [out, inLeg] = transferPair(
      "t-out", "t-in", "transfer-1",
      50000n,
      "acc-bank-1",
      "acc-bank-2",
    );
    const snapshot = makeSnapshot(
      [out, inLeg],
      [],
      [opAccount("acc-bank-1"), opAccount("acc-bank-2")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.need, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.want, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.save, zeroUsd())).toBe(true);
  });

  // Cell 3: savings → savings (§5.6 rule 7) — neutral
  it("§5.6 rule 7: savings→savings is neutral (internal reorganization)", () => {
    const [out, inLeg] = transferPair(
      "t-out", "t-in", "transfer-1",
      50000n,
      "acc-sav-1",
      "acc-sav-2",
    );
    const snapshot = makeSnapshot(
      [out, inLeg],
      [],
      [savingsAccount("acc-sav-1"), savingsAccount("acc-sav-2")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.save, zeroUsd())).toBe(true);
  });

  // Cell 4: savings → operational (§5.6 rule 8) — neutral (dis-saving not reversed)
  it("§5.6 rule 8: savings→operational is neutral (withdrawal not reversed)", () => {
    const [out, inLeg] = transferPair(
      "t-out", "t-in", "transfer-1",
      30000n,
      "acc-savings",
      "acc-bank",
    );
    const snapshot = makeSnapshot(
      [out, inLeg],
      [],
      [savingsAccount("acc-savings"), opAccount("acc-bank")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, zeroUsd())).toBe(true);
    expect(equals(result.expenseByBucket.save, zeroUsd())).toBe(true);
  });

  // Multiple operational→savings transfers accumulate
  it("accumulates multiple operational→savings transfers", () => {
    const [out1, in1] = transferPair("t1-out", "t1-in", "tf-1", 20000n, "acc-bank", "acc-sav");
    const [out2, in2] = transferPair("t2-out", "t2-in", "tf-2", 15000n, "acc-bank", "acc-sav");
    const snapshot = makeSnapshot(
      [out1, in1, out2, in2],
      [],
      [opAccount("acc-bank"), savingsAccount("acc-sav")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, usd(35000n))).toBe(true);
  });

  // Orphan transfer leg (no pair) is ignored safely
  it("ignores orphan transfer leg without a pair", () => {
    const orphan: SnapshotTransaction = {
      id: "orphan",
      kind: "transfer",
      amount: usd(50000n),
      date: "2025-01-15",
      accountId: "acc-bank",
      transferId: "tf-orphan",
      transferLeg: "out",
    };
    const snapshot = makeSnapshot(
      [orphan],
      [],
      [opAccount("acc-bank")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, zeroUsd())).toBe(true);
  });

  // Malformed pair: two legs but both with 'in' leg designation (no 'out' found) → ignored
  it("ignores malformed pair where outLeg cannot be found", () => {
    const in1: SnapshotTransaction = {
      id: "in-1",
      kind: "transfer",
      amount: usd(20000n),
      date: "2025-01-15",
      accountId: "acc-bank",
      transferId: "tf-malformed",
      transferLeg: "in", // both are 'in' — no 'out' leg
    };
    const in2: SnapshotTransaction = {
      id: "in-2",
      kind: "transfer",
      amount: usd(20000n),
      date: "2025-01-15",
      accountId: "acc-bank-2",
      transferId: "tf-malformed",
      transferLeg: "in", // both are 'in'
    };
    const snapshot = makeSnapshot(
      [in1, in2],
      [],
      [opAccount("acc-bank"), opAccount("acc-bank-2")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, zeroUsd())).toBe(true);
  });

  // Transfer pair where account is not found in snapshot.accounts map → ignored
  it("ignores transfer pair where outLeg account is missing from accounts list", () => {
    const [out, inLeg] = transferPair(
      "t-out", "t-in", "tf-missing-acc",
      20000n,
      "acc-missing", // not present in snapshot accounts
      "acc-savings",
    );
    const snapshot = makeSnapshot(
      [out, inLeg],
      [],
      // acc-missing is NOT in accounts — only acc-savings
      [savingsAccount("acc-savings")],
    );
    const result = classify(snapshot);
    expect(equals(result.transferSavingsInflow, zeroUsd())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5.6 rule 9: save-bucket expenses + transfer inflow are BOTH in expenseByBucket / transferSavingsInflow
// (combined savings computation is tested in savings.test.ts)
// ---------------------------------------------------------------------------

describe("classify — save-bucket expenses are separate from transfer inflow", () => {
  it("save-bucket expense goes to expenseByBucket.save, not transferSavingsInflow", () => {
    const snapshot = makeSnapshot(
      [expenseTx("e1", 10000n, "cat-save")],
      [saveCategory("cat-save")],
      [opAccount("acc-op-1")],
    );
    const result = classify(snapshot);
    expect(equals(result.expenseByBucket.save, usd(10000n))).toBe(true);
    expect(equals(result.transferSavingsInflow, zeroUsd())).toBe(true);
  });
});
