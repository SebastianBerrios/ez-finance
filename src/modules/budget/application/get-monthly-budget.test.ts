import { describe, expect, it, vi } from "vitest";

import type { MonthlySnapshot } from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";

import { getMonthlyBudget } from "./get-monthly-budget";
import type { BudgetConfigPort } from "./ports/budget-config-port";
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
      findForMonth: vi.fn().mockResolvedValue({ ok: true, value: configValue }),
    },
  };
}

const STORED_CONFIG = {
  incomeMode: "esperado" as const,
  expectedIncomeMinorUnits: 350000n,
  percentages: { need: 50, want: 30, save: 20 },
};

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
});
