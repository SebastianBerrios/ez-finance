// transfer-classifier.ts — pure domain: classify snapshot transactions
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type {
  MonthlySnapshot,
  SnapshotTransaction,
  Bucket,
  AccountType,
} from "@shared/domain/budget-types";
import type { Money, CurrencyCode } from "@shared/domain/money";
import { zero, add } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface Classified {
  /** Sum of all income-kind transactions */
  readonly incomeTotal: Money;
  /** Expenses keyed by categoryId (known categories only) */
  readonly expenseByCategory: ReadonlyMap<string, Money>;
  /** Expenses aggregated into the three budget buckets */
  readonly expenseByBucket: {
    readonly need: Money;
    readonly want: Money;
    readonly save: Money;
  };
  /**
   * Sum of OUT-leg amounts for operational→savings transfers only.
   * This feeds the savings bucket (see computeSavings).
   */
  readonly transferSavingsInflow: Money;
}

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

/**
 * Classify snapshot transactions into per-bucket totals.
 *
 * Transfer matrix (keyed by out-account type → in-account type):
 *   operational → savings    : OUT leg amount → transferSavingsInflow
 *   operational → operational: neutral (no bucket)
 *   savings → savings        : neutral (internal reorganization)
 *   savings → operational    : neutral (dis-saving not reversed)
 *
 * Unknown-category transactions are SILENTLY IGNORED (not counted, no throw).
 * Archived categories STILL COUNT as if active.
 */
export function classify(snapshot: MonthlySnapshot): Classified {
  const cur = snapshot.baseCurrency;

  // Build fast lookup maps
  const accountType = new Map<string, AccountType>();
  for (const acc of snapshot.accounts) {
    accountType.set(acc.id, acc.type);
  }

  const categoryBucket = new Map<string, Bucket | null>();
  for (const cat of snapshot.categories) {
    categoryBucket.set(cat.id, cat.bucket);
  }

  // Accumulators
  let incomeTotal = expectOk(zero(cur));
  let needExpense = expectOk(zero(cur));
  let wantExpense = expectOk(zero(cur));
  let saveExpense = expectOk(zero(cur));
  let transferSavingsInflow = expectOk(zero(cur));
  const expenseByCategory = new Map<string, Money>();

  // Separate transactions by kind for efficient grouping
  const transfersByTransferId = new Map<string, SnapshotTransaction[]>();

  for (const tx of snapshot.transactions) {
    switch (tx.kind) {
      case "income":
        incomeTotal = expectOk(add(incomeTotal, tx.amount));
        break;

      case "expense": {
        // Unknown/missing categoryId → silent ignore
        if (tx.categoryId === undefined) break;
        if (!categoryBucket.has(tx.categoryId)) break;

        const bucket = categoryBucket.get(tx.categoryId)!;
        // Add to per-category map
        const prev = expenseByCategory.get(tx.categoryId);
        const updated = prev !== undefined
          ? expectOk(add(prev, tx.amount))
          : tx.amount;
        expenseByCategory.set(tx.categoryId, updated);

        // Add to bucket aggregate (null bucket = unbucketed, skip bucket total)
        if (bucket === "need") {
          needExpense = expectOk(add(needExpense, tx.amount));
        } else if (bucket === "want") {
          wantExpense = expectOk(add(wantExpense, tx.amount));
        } else if (bucket === "save") {
          saveExpense = expectOk(add(saveExpense, tx.amount));
        }
        // bucket === null → counted in expenseByCategory but not any bucket
        break;
      }

      case "transfer": {
        // Group by transferId for pair processing
        if (tx.transferId !== undefined) {
          const group = transfersByTransferId.get(tx.transferId);
          if (group !== undefined) {
            group.push(tx);
          } else {
            transfersByTransferId.set(tx.transferId, [tx]);
          }
        }
        // Orphan legs (no transferId) are ignored entirely
        break;
      }
    }
  }

  // Process transfer pairs
  for (const [, legs] of transfersByTransferId) {
    // Need exactly 2 legs to classify a transfer pair
    if (legs.length !== 2) continue; // orphan or malformed → ignore

    const outLeg = legs.find((l) => l.transferLeg === "out");
    const inLeg = legs.find((l) => l.transferLeg === "in");
    if (outLeg === undefined || inLeg === undefined) continue; // malformed

    const outType = accountType.get(outLeg.accountId);
    const inType = accountType.get(inLeg.accountId);
    if (outType === undefined || inType === undefined) continue; // missing account

    const outIsSavings = outType === "savings";
    const inIsSavings = inType === "savings";

    // Transfer matrix
    if (!outIsSavings && inIsSavings) {
      // operational → savings: count OUT leg in transferSavingsInflow
      transferSavingsInflow = expectOk(add(transferSavingsInflow, outLeg.amount));
    }
    // All other cells (op→op, sav→sav, sav→op): neutral — no bucket consumed
  }

  return {
    incomeTotal,
    expenseByCategory,
    expenseByBucket: {
      need: needExpense,
      want: wantExpense,
      save: saveExpense,
    },
    transferSavingsInflow,
  };
}
