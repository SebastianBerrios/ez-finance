// monthly-report.ts — pure domain: "where did the money go this month?"
//
// A FUNCTION OVER THE SNAPSHOT, not a query. The snapshot already carries the
// month's transactions, its categories and their buckets, because the budget engine
// needs exactly that — so a report is an aggregation, not a new read. Writing it as
// SQL would have put the "what counts as spending" rules in a second place, where
// they could disagree with the engine about the same month.

import type {
  Bucket,
  MonthlySnapshot,
  SnapshotCategory,
} from "@shared/domain/budget-types";
import type { Money } from "@shared/domain/money";
import { add, compare, zero } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

export interface CategorySpend {
  /** null for spending with no category — shown, never dropped. */
  readonly categoryId: string | null;
  readonly bucket: Bucket | null;
  readonly total: Money;
}

export interface MonthlyReport {
  readonly income: Money;
  readonly expense: Money;
  readonly byBucket: Readonly<Record<Bucket, Money>>;
  /** Spending that lands in no bucket: no category, or a category without one. */
  readonly unbucketed: Money;
  /** Biggest first — the question is "where did it go". */
  readonly byCategory: readonly CategorySpend[];
}

export function monthlyReport(snapshot: MonthlySnapshot): MonthlyReport {
  const none = expectOk(zero(snapshot.baseCurrency));
  const plus = (a: Money, b: Money) => expectOk(add(a, b));

  const bucketOf = new Map<string, Bucket | null>(
    snapshot.categories.map((category: SnapshotCategory) => [
      category.id,
      category.bucket,
    ]),
  );

  let income = none;
  let expense = none;
  let unbucketed = none;
  const byBucket: Record<Bucket, Money> = {
    need: none,
    want: none,
    save: none,
  };
  const perCategory = new Map<
    string | null,
    { bucket: Bucket | null; total: Money }
  >();

  for (const tx of snapshot.transactions) {
    // TRANSFERS ARE NOT SPENDING. They move money between the person's own accounts;
    // counting them would report an expense every time savings were moved. The engine
    // applies the same rule, and a report that disagreed with the dashboard about one
    // month would be worse than no report at all.
    if (tx.kind === "transfer") continue;

    if (tx.kind === "income") {
      income = plus(income, tx.amount);
      continue;
    }

    expense = plus(expense, tx.amount);

    // ARCHIVED CATEGORIES STILL COUNT, deliberately: archiving is not deleting, and
    // the month that spent the money keeps it. bucketOf is built from every category
    // in the snapshot, archived included, for exactly that reason.
    const categoryId = tx.categoryId ?? null;
    const bucket =
      categoryId === null ? null : (bucketOf.get(categoryId) ?? null);

    if (bucket === null) {
      unbucketed = plus(unbucketed, tx.amount);
    } else {
      byBucket[bucket] = plus(byBucket[bucket], tx.amount);
    }

    const existing = perCategory.get(categoryId);
    perCategory.set(categoryId, {
      bucket,
      total:
        existing === undefined ? tx.amount : plus(existing.total, tx.amount),
    });
  }

  const byCategory: CategorySpend[] = [...perCategory.entries()]
    .map(([categoryId, { bucket, total }]) => ({ categoryId, bucket, total }))
    // Descending. compare returns -1 | 0 | 1 and both sides share the snapshot's
    // currency, so it cannot fail here.
    .sort((a, b) => expectOk(compare(b.total, a.total)));

  return {
    income,
    expense,
    byBucket: Object.freeze(byBucket),
    unbucketed,
    byCategory,
  };
}
