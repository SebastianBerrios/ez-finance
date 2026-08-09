import { describe, expect, it, vi } from "vitest";

import type {
  BudgetConfigPort,
  StoredBudgetConfig,
} from "./ports/budget-config-port";
import { setCategoryLimit } from "./set-category-limit";

const MONTH = new Date("2026-07-15T00:00:00Z");

const CONFIG: StoredBudgetConfig = {
  id: "cfg-1",
  categoryLimits: [],
  incomeMode: "esperado",
  expectedIncomeMinorUnits: 350000n,
  percentages: { need: 50, want: 30, save: 20 },
};

function makePort(overrides: Partial<BudgetConfigPort> = {}): BudgetConfigPort {
  return {
    saveFromMonth: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    findForMonth: vi.fn().mockResolvedValue({ ok: true, value: CONFIG }),
    setCategoryLimit: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...overrides,
  };
}

const INPUT = {
  workspaceId: "ws-1",
  month: MONTH,
  categoryId: "cat-1",
  limitMinorUnits: 50000n,
};

describe("setCategoryLimit", () => {
  it("writes the limit against the config in force for the month", async () => {
    // The reason this is a use case: a limit belongs to a specific config version, and
    // "which config is in force for month M" has one correct answer.
    const budget = makePort();

    const result = await setCategoryLimit(INPUT, { budget });

    expect(result.ok).toBe(true);
    expect(budget.findForMonth).toHaveBeenCalledWith("ws-1", MONTH);
    expect(budget.setCategoryLimit).toHaveBeenCalledWith(
      "ws-1",
      "cfg-1",
      "cat-1",
      50000n,
    );
  });

  it("passes null through to CLEAR a limit", async () => {
    const budget = makePort();

    const result = await setCategoryLimit(
      { ...INPUT, limitMinorUnits: null },
      { budget },
    );

    expect(result.ok).toBe(true);
    expect(budget.setCategoryLimit).toHaveBeenCalledWith(
      "ws-1",
      "cfg-1",
      "cat-1",
      null,
    );
  });

  it("REFUSES zero, which is a prohibition rather than a budget", async () => {
    // The engine would read every peso spent against the category as over budget, and
    // the column refuses it too. Someone who means "never spend here" archives the
    // category; clearing the ceiling is null, a different intent.
    const budget = makePort();

    const result = await setCategoryLimit(
      { ...INPUT, limitMinorUnits: 0n },
      { budget },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidConfig");
    expect(budget.setCategoryLimit).not.toHaveBeenCalled();
  });

  it("refuses a negative limit", async () => {
    const budget = makePort();

    const result = await setCategoryLimit(
      { ...INPUT, limitMinorUnits: -100n },
      { budget },
    );

    expect(result.ok).toBe(false);
    expect(budget.setCategoryLimit).not.toHaveBeenCalled();
  });

  it("reports NotConfigured when the month has no budget yet", async () => {
    // There is nothing to hang a limit on. The honest answer is the wizard, not
    // inventing a budget config as a side effect of typing into a field.
    const budget = makePort({
      findForMonth: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });

    const result = await setCategoryLimit(INPUT, { budget });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotConfigured");
    expect(budget.setCategoryLimit).not.toHaveBeenCalled();
  });

  it("propagates a failed config read rather than guessing", async () => {
    const budget = makePort({
      findForMonth: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "Unavailable" } }),
    });

    const result = await setCategoryLimit(INPUT, { budget });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("propagates the write's own refusal — RLS is the real gate", async () => {
    // Only owner and admin manage the budget (spec §4), and an archived workspace
    // refuses every write. Both arrive here as the port's error.
    const budget = makePort({
      setCategoryLimit: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "NotPermitted" } }),
    });

    const result = await setCategoryLimit(INPUT, { budget });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("rejects a blank workspace and a blank category without reading anything", async () => {
    const budget = makePort();

    expect(
      (await setCategoryLimit({ ...INPUT, workspaceId: " " }, { budget })).ok,
    ).toBe(false);
    expect(
      (await setCategoryLimit({ ...INPUT, categoryId: " " }, { budget })).ok,
    ).toBe(false);
    expect(budget.findForMonth).not.toHaveBeenCalled();
  });
});
