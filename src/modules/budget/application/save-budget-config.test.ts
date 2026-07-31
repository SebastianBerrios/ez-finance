import { describe, expect, it, vi } from "vitest";

import type { BudgetConfigPort } from "./ports/budget-config-port";
import { saveBudgetConfig } from "./save-budget-config";

function makePort(overrides: Partial<BudgetConfigPort> = {}): BudgetConfigPort {
  return {
    saveFromMonth: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    findForMonth: vi.fn().mockResolvedValue({ ok: true, value: null }),
    ...overrides,
  };
}

const MONTH = new Date("2026-07-15T00:00:00Z");

const INPUT = {
  workspaceId: "ws-1",
  month: MONTH,
  incomeMode: "mayor",
  expectedIncomeMinorUnits: 500000n,
  percentages: { need: 50, want: 30, save: 20 },
};

describe("saveBudgetConfig", () => {
  it("stores the 50/30/20 default", async () => {
    const budget = makePort();

    const result = await saveBudgetConfig(INPUT, { budget });

    expect(result.ok).toBe(true);
    expect(budget.saveFromMonth).toHaveBeenCalledWith(
      "ws-1",
      MONTH,
      expect.objectContaining({
        percentages: { need: 50, want: 30, save: 20 },
      }),
    );
  });

  it("stores a custom split — 50/30/20 is the default, not the rule", async () => {
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, percentages: { need: 70, want: 20, save: 10 } },
      { budget },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(budget.saveFromMonth).toHaveBeenCalled();
  });

  it("rejects percentages that do not sum to 100 without calling the port", async () => {
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, percentages: { need: 60, want: 30, save: 20 } },
      { budget },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidConfig");
    expect(budget.saveFromMonth).not.toHaveBeenCalled();
  });

  it("rejects a negative percentage", async () => {
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, percentages: { need: 110, want: 0, save: -10 } },
      { budget },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidConfig");
  });

  it("rejects fractional percentages", async () => {
    // The engine would round them downstream and distort the targets, so they
    // are refused rather than silently accepted.
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, percentages: { need: 33.3, want: 33.3, save: 33.4 } },
      { budget },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidConfig");
  });

  it("rejects a negative expected income", async () => {
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, expectedIncomeMinorUnits: -1n },
      { budget },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidConfig");
    expect(budget.saveFromMonth).not.toHaveBeenCalled();
  });

  it("accepts an expected income of zero", async () => {
    // The engine defines targets of 0 and a consumption of 0% for a month with
    // no income, so someone who does not know their income yet is not blocked.
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, expectedIncomeMinorUnits: 0n },
      { budget },
    );

    expect(result.ok).toBe(true);
  });

  it("rejects an income mode the engine does not know", async () => {
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, incomeMode: "promedio" },
      { budget },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidConfig");
  });

  it.each(["mayor", "real", "esperado"])(
    "accepts the '%s' income mode",
    async (mode) => {
      const budget = makePort();

      const result = await saveBudgetConfig(
        { ...INPUT, incomeMode: mode },
        { budget },
      );

      expect(result.ok).toBe(true);
    },
  );

  it("rejects a blank workspace id", async () => {
    const budget = makePort();

    const result = await saveBudgetConfig(
      { ...INPUT, workspaceId: " " },
      { budget },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceNotFound");
  });

  it("propagates a port error unchanged", async () => {
    const budget = makePort({
      saveFromMonth: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "NotPermitted" } }),
    });

    const result = await saveBudgetConfig(INPUT, { budget });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("omits nearLimitThresholdPct when not supplied, rather than sending undefined", async () => {
    // exactOptionalPropertyTypes is on, and the engine defaults the threshold to
    // 80 when the key is ABSENT — a present-but-undefined value is not the same.
    const budget = makePort();

    await saveBudgetConfig(INPUT, { budget });

    const stored = vi.mocked(budget.saveFromMonth).mock.calls[0]?.[2];
    expect(stored && "nearLimitThresholdPct" in stored).toBe(false);
  });

  it("passes nearLimitThresholdPct through when supplied", async () => {
    const budget = makePort();

    await saveBudgetConfig({ ...INPUT, nearLimitThresholdPct: 90 }, { budget });

    expect(budget.saveFromMonth).toHaveBeenCalledWith(
      "ws-1",
      MONTH,
      expect.objectContaining({ nearLimitThresholdPct: 90 }),
    );
  });
});
