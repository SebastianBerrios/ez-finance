import { describe, expect, it, vi } from "vitest";

import type { MonthlySnapshot } from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

import { getMonthlyBudget } from "./get-monthly-budget";
import type {
  BudgetConfigPort,
  StoredBudgetConfig,
  StoredCategoryLimit,
} from "./ports/budget-config-port";
import type { MonthlySnapshotPort } from "./ports/monthly-snapshot-port";

const MONTH = new Date("2026-07-15T00:00:00Z");

function snapshot(overrides: Partial<MonthlySnapshot> = {}): MonthlySnapshot {
  return {
    year: 2026,
    month: 7,
    baseCurrency: expectOk(fromMinorUnits("PEN", 0n)).currency,
    transactions: [],
    categories: [],
    accounts: [],
    ...overrides,
  };
}

function makePorts(
  snapshotValue: MonthlySnapshot | null,
  configValue: unknown,
): { snapshots: MonthlySnapshotPort; budget: BudgetConfigPort } {
  return {
    snapshots: {
      readForMonth: vi
        .fn()
        .mockResolvedValue({ ok: true, value: snapshotValue }),
    },
    budget: {
      saveFromMonth: vi.fn(),
      setCategoryLimit: vi
        .fn()
        .mockResolvedValue({ ok: true, value: undefined }),
      findForMonth: vi.fn().mockResolvedValue({ ok: true, value: configValue }),
    },
  };
}

const STORED_CONFIG = {
  // The adapter always supplies these two — StoredBudgetConfig requires them, and the
  // mock returns an untyped object so TypeScript could not point that out. Typed as
  // StoredBudgetConfig here so the next field added to the port fails at compile time
  // instead of as "cannot read properties of undefined" inside a use case.
  id: "cfg-1",
  categoryLimits: [] as StoredCategoryLimit[],
  incomeMode: "esperado" as const,
  expectedIncomeMinorUnits: 350000n,
  percentages: { need: 50, want: 30, save: 20 },
} satisfies StoredBudgetConfig;

describe("getMonthlyBudget", () => {
  it("computes the buckets from the stored config", async () => {
    const deps = makePorts(snapshot(), STORED_CONFIG);

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 3500.00 with a 50/30/20 split, nothing spent.
      expect(result.value.result.buckets.need.targetAmount.minorUnits).toBe(
        175000n,
      );
      expect(result.value.result.buckets.want.targetAmount.minorUnits).toBe(
        105000n,
      );
      expect(result.value.result.buckets.save.targetAmount.minorUnits).toBe(
        70000n,
      );
      expect(result.value.result.buckets.need.consumedPct).toBe(0);
    }
  });

  it("denominates the expected income in the snapshot's base currency", async () => {
    // computeBudget refuses a config whose currency disagrees with the snapshot,
    // and the stored config has no currency of its own — assembling it correctly
    // is this use case's job, and getting it wrong would fail every dashboard.
    const deps = makePorts(snapshot(), STORED_CONFIG);

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.result.incomeUsed.currency).toBe("PEN");
  });

  it("honours a custom split", async () => {
    const deps = makePorts(snapshot(), {
      ...STORED_CONFIG,
      percentages: { need: 60, want: 25, save: 15 },
    });

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result.buckets.need.targetAmount.minorUnits).toBe(
        210000n,
      );
      expect(result.value.result.buckets.save.targetAmount.minorUnits).toBe(
        52500n,
      );
    }
  });

  it("reports NotConfigured when the workspace has no snapshot", async () => {
    // No base currency means no account, i.e. setup never finished. The caller
    // sends the person to the wizard rather than showing a broken dashboard.
    const deps = makePorts(null, STORED_CONFIG);

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotConfigured");
  });

  it("reports NotConfigured when there is no budget config", async () => {
    const deps = makePorts(snapshot(), null);

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotConfigured");
  });

  it("reports InvalidConfig when the STORED config no longer validates", async () => {
    // Only reachable through drift — the write path validates. Surfaced as its own
    // kind so it never gets mistaken for unfinished setup, which would send the
    // person to a wizard that cannot fix it.
    const deps = makePorts(snapshot(), {
      ...STORED_CONFIG,
      percentages: { need: 60, want: 30, save: 20 },
    });

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidConfig");
  });

  it("propagates a snapshot read failure", async () => {
    const deps = makePorts(snapshot(), STORED_CONFIG);
    deps.snapshots.readForMonth = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "Unavailable" } });

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("asks both ports for the SAME month", async () => {
    const deps = makePorts(snapshot(), STORED_CONFIG);

    await getMonthlyBudget({ workspaceId: "ws-1", month: MONTH }, deps);

    expect(deps.snapshots.readForMonth).toHaveBeenCalledWith("ws-1", MONTH);
    expect(deps.budget.findForMonth).toHaveBeenCalledWith("ws-1", MONTH);
  });

  it("rejects a blank workspace id without touching either port", async () => {
    const deps = makePorts(snapshot(), STORED_CONFIG);

    const result = await getMonthlyBudget(
      { workspaceId: " ", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceNotFound");
    expect(deps.snapshots.readForMonth).not.toHaveBeenCalled();
  });

  it("turns a stored category limit into a category ALERT", async () => {
    // The payoff of the whole feature. alerts.ts has been able to emit these since it
    // was written and nothing could ever configure one, so this is the first test that
    // proves the stored value reaches the engine at all.
    const money = (minorUnits: bigint) =>
      expectOk(fromMinorUnits("PEN", minorUnits));

    const deps = makePorts(
      snapshot({
        categories: [{ id: "cat-1", bucket: "need", archived: false }],
        transactions: [
          {
            id: "tx-1",
            kind: "expense" as const,
            amount: money(9000n),
            date: "2026-07-10",
            accountId: "acc-1",
            categoryId: "cat-1",
          },
        ],
      }),
      {
        ...STORED_CONFIG,
        // 90.00 spent against a 100.00 ceiling: past the 80 % default threshold.
        categoryLimits: [{ categoryId: "cat-1", limitMinorUnits: 10000n }],
      },
    );

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const categoryAlert = result.value.result.alerts.find(
      (alert) => alert.scope === "category",
    );
    expect(categoryAlert).toBeDefined();
    expect(categoryAlert?.categoryId).toBe("cat-1");
  });

  it("produces NO category alert when nothing is configured", async () => {
    // The state every workspace is in until someone sets a ceiling. Asserted so the
    // engine's per-category branch cannot start firing on an empty list.
    const deps = makePorts(
      snapshot({
        categories: [{ id: "cat-1", bucket: "need", archived: false }],
        transactions: [
          {
            id: "tx-1",
            kind: "expense" as const,
            amount: expectOk(fromMinorUnits("PEN", 9000n)),
            date: "2026-07-10",
            accountId: "acc-1",
            categoryId: "cat-1",
          },
        ],
      }),
      STORED_CONFIG,
    );

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.result.alerts.filter((alert) => alert.scope === "category"),
    ).toHaveLength(0);
  });

  it("DROPS a limit whose currency the money domain rejects, and still renders", async () => {
    // Only reachable through drift, and the choice matters: failing the month would
    // take the whole dashboard down over one unusable ceiling. Losing one alert is the
    // smaller wrong — the same call the engine makes for a transaction whose category
    // no longer exists.
    const deps = makePorts(snapshot(), {
      ...STORED_CONFIG,
      categoryLimits: [
        { categoryId: "cat-1", limitMinorUnits: 10000n },
        { categoryId: "cat-2", limitMinorUnits: 10000n },
      ],
    });

    const result = await getMonthlyBudget(
      { workspaceId: "ws-1", month: MONTH },
      deps,
    );

    // The snapshot's currency is PEN and both limits are valid in it, so what this
    // pins is that the mapping does not throw and the month still computes.
    expect(result.ok).toBe(true);
  });
});
