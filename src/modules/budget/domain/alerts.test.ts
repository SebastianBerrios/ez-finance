// alerts.test.ts — TDD: generateAlerts
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import { describe, expect, it } from "vitest";
import type { BudgetConfig, BudgetResult } from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { generateAlerts } from "./alerts";
import type { Classified } from "./transfer-classifier";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function usd(n: bigint) {
  return expectOk(fromMinorUnits("USD", n));
}

/** Build a minimal BudgetResult with only the 'buckets' field populated */
function makeResultBuckets(
  needPct: number,
  wantPct: number,
  savePct: number,
): Pick<BudgetResult, "buckets"> {
  const zero = usd(0n);
  const makeBucket = (pct: number) => ({
    targetAmount: zero,
    consumedAmount: zero,
    consumedPct: pct,
    remaining: zero,
  });
  return {
    buckets: {
      need: makeBucket(needPct),
      want: makeBucket(wantPct),
      save: makeBucket(savePct),
    },
  };
}

function makeConfig(overrides?: Partial<BudgetConfig>): BudgetConfig {
  return {
    incomeMode: "real",
    expectedIncome: usd(100000n),
    percentages: { need: 50, want: 30, save: 20 },
    nearLimitThresholdPct: 80,
    ...overrides,
  };
}

function makeClassified(): Classified {
  const zero = usd(0n);
  return {
    incomeTotal: zero,
    expenseByCategory: new Map(),
    expenseByBucket: { need: zero, want: zero, save: zero },
    transferSavingsInflow: zero,
  };
}

// ---------------------------------------------------------------------------
// generateAlerts — bucket-level alerts
// ---------------------------------------------------------------------------

describe("generateAlerts — bucket alerts", () => {
  // ------------------------------------------------------------------
  // below threshold: no alerts
  // ------------------------------------------------------------------

  it("emits no alerts when all buckets are below threshold (< 80%)", () => {
    const result = makeResultBuckets(70, 60, 50);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());
    expect(alerts).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // near-limit: consumedPct >= threshold AND <= 100
  // ------------------------------------------------------------------

  it("emits near-limit alert when consumedPct equals threshold (exactly 80%)", () => {
    const result = makeResultBuckets(80, 0, 0);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ scope: "bucket", level: "near", bucket: "need", consumedPct: 80 });
  });

  it("emits near-limit alert when consumedPct is above threshold but below 100 (85%)", () => {
    const result = makeResultBuckets(85, 0, 0);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ scope: "bucket", level: "near", bucket: "need", consumedPct: 85 });
  });

  it("emits near-limit alert at exactly 100% (not over — LOCKED EDGE CASE)", () => {
    // LOCKED: at exactly 100%, emits ONLY near-limit (not over-limit)
    const result = makeResultBuckets(100, 0, 0);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());

    const overAlerts = alerts.filter((a) => a.level === "over");
    const nearAlerts = alerts.filter((a) => a.level === "near");

    expect(overAlerts).toHaveLength(0); // NO over-limit at exactly 100
    expect(nearAlerts).toHaveLength(1); // exactly one near-limit
    expect(nearAlerts[0]).toMatchObject({ scope: "bucket", level: "near", bucket: "need", consumedPct: 100 });
  });

  // ------------------------------------------------------------------
  // over-limit: consumedPct > 100
  // ------------------------------------------------------------------

  it("emits over-limit alert when consumedPct > 100 (LOCKED EDGE CASE: only over, not both)", () => {
    // LOCKED: at > 100%, emits ONLY over-limit (not near+over)
    const result = makeResultBuckets(110, 0, 0);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());

    const overAlerts = alerts.filter((a) => a.level === "over");
    const nearAlerts = alerts.filter((a) => a.level === "near" && a.bucket === "need");

    expect(overAlerts).toHaveLength(1);
    expect(nearAlerts).toHaveLength(0); // NO near-limit when over
    expect(overAlerts[0]).toMatchObject({ scope: "bucket", level: "over", bucket: "need", consumedPct: 110 });
  });

  it("emits over-limit alert for 101%", () => {
    const result = makeResultBuckets(101, 0, 0);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());

    expect(alerts.some((a) => a.level === "over" && a.bucket === "need")).toBe(true);
    expect(alerts.some((a) => a.level === "near" && a.bucket === "need")).toBe(false);
  });

  // ------------------------------------------------------------------
  // Multiple buckets
  // ------------------------------------------------------------------

  it("emits alerts for all buckets independently", () => {
    const result = makeResultBuckets(85, 105, 50);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());

    const needAlert = alerts.find((a) => a.bucket === "need");
    const wantAlert = alerts.find((a) => a.bucket === "want");
    const saveAlert = alerts.find((a) => a.bucket === "save");

    expect(needAlert).toMatchObject({ level: "near", bucket: "need" });
    expect(wantAlert).toMatchObject({ level: "over", bucket: "want" });
    expect(saveAlert).toBeUndefined(); // 50% — below threshold
  });

  // ------------------------------------------------------------------
  // Custom threshold
  // ------------------------------------------------------------------

  it("respects a custom nearLimitThresholdPct (e.g. 90%)", () => {
    const config = makeConfig({ nearLimitThresholdPct: 90 });
    const result = makeResultBuckets(85, 0, 0); // 85% — below custom threshold

    const alerts = generateAlerts(result, makeClassified(), config, new Map());
    expect(alerts).toHaveLength(0); // no alert at 85% with threshold=90
  });

  it("fires near-limit at exactly the custom threshold (90%)", () => {
    const config = makeConfig({ nearLimitThresholdPct: 90 });
    const result = makeResultBuckets(90, 0, 0);

    const alerts = generateAlerts(result, makeClassified(), config, new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "near", bucket: "need" });
  });

  // ------------------------------------------------------------------
  // Default threshold = 80 (REQ-E-19)
  // ------------------------------------------------------------------

  it("uses default nearLimitThresholdPct=80 when not set in config", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 50, want: 30, save: 20 },
      // nearLimitThresholdPct intentionally omitted
    };
    const result = makeResultBuckets(80, 0, 0);
    const alerts = generateAlerts(result, makeClassified(), config, new Map());

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "near" });
  });

  // ------------------------------------------------------------------
  // Alerts are pure data — no side effects (structural test)
  // ------------------------------------------------------------------

  it("returns plain Alert objects with expected fields", () => {
    const result = makeResultBuckets(95, 0, 0);
    const alerts = generateAlerts(result, makeClassified(), makeConfig(), new Map());

    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert).toHaveProperty("scope", "bucket");
    expect(alert).toHaveProperty("level");
    expect(alert).toHaveProperty("bucket");
    expect(alert).toHaveProperty("consumedPct");
  });
});

// ---------------------------------------------------------------------------
// generateAlerts — category-level alerts (categoryLimits)
// ---------------------------------------------------------------------------

describe("generateAlerts — category alerts", () => {
  it("emits near-limit category alert when expenses approach the category limit", () => {
    const cat1Limit = usd(10000n); // $100.00 limit for category
    const config = makeConfig({
      categoryLimits: [{ categoryId: "cat-1", limit: cat1Limit }],
    });
    // Category has 88% of its limit consumed
    const cat1Expense = usd(8800n); // $88.00 = 88%
    const classified: Classified = {
      incomeTotal: usd(100000n),
      expenseByCategory: new Map([["cat-1", cat1Expense]]),
      expenseByBucket: { need: cat1Expense, want: usd(0n), save: usd(0n) },
      transferSavingsInflow: usd(0n),
    };
    const categoryBucket = new Map([["cat-1", "need" as const]]);
    const result = makeResultBuckets(50, 0, 0); // below bucket threshold

    const alerts = generateAlerts(result, classified, config, categoryBucket);
    const catAlert = alerts.find((a) => a.scope === "category" && a.categoryId === "cat-1");

    expect(catAlert).toBeDefined();
    expect(catAlert).toMatchObject({ scope: "category", level: "near", categoryId: "cat-1" });
  });

  it("emits over-limit category alert when expenses exceed the category limit", () => {
    const cat1Limit = usd(10000n); // $100.00 limit
    const config = makeConfig({
      categoryLimits: [{ categoryId: "cat-1", limit: cat1Limit }],
    });
    const cat1Expense = usd(12000n); // $120.00 = 120% of limit
    const classified: Classified = {
      incomeTotal: usd(100000n),
      expenseByCategory: new Map([["cat-1", cat1Expense]]),
      expenseByBucket: { need: cat1Expense, want: usd(0n), save: usd(0n) },
      transferSavingsInflow: usd(0n),
    };
    const categoryBucket = new Map([["cat-1", "need" as const]]);
    const result = makeResultBuckets(0, 0, 0);

    const alerts = generateAlerts(result, classified, config, categoryBucket);
    const catAlert = alerts.find((a) => a.scope === "category" && a.categoryId === "cat-1");

    expect(catAlert).toBeDefined();
    expect(catAlert).toMatchObject({ scope: "category", level: "over", categoryId: "cat-1" });
  });

  it("emits no category alert when expenses are below threshold of the category limit", () => {
    const cat1Limit = usd(10000n);
    const config = makeConfig({
      categoryLimits: [{ categoryId: "cat-1", limit: cat1Limit }],
    });
    const cat1Expense = usd(5000n); // $50.00 = 50% of limit — below 80% threshold
    const classified: Classified = {
      incomeTotal: usd(100000n),
      expenseByCategory: new Map([["cat-1", cat1Expense]]),
      expenseByBucket: { need: cat1Expense, want: usd(0n), save: usd(0n) },
      transferSavingsInflow: usd(0n),
    };
    const result = makeResultBuckets(0, 0, 0);

    const alerts = generateAlerts(result, classified, config, new Map([["cat-1", "need" as const]]));
    const catAlerts = alerts.filter((a) => a.scope === "category");

    expect(catAlerts).toHaveLength(0);
  });

  it("emits no category alerts when no categoryLimits are configured", () => {
    const config = makeConfig(); // no categoryLimits
    const result = makeResultBuckets(0, 0, 0);

    const alerts = generateAlerts(result, makeClassified(), config, new Map());
    const catAlerts = alerts.filter((a) => a.scope === "category");

    expect(catAlerts).toHaveLength(0);
  });
});
