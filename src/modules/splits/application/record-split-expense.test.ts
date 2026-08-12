import { describe, expect, it, vi } from "vitest";

import type { SplitPort } from "./ports/split-port";
import { recordSplitExpense } from "./record-split-expense";

function makePort(overrides: Partial<SplitPort> = {}): SplitPort {
  return {
    recordSplitExpense: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "tx-1" } }),
    listOwed: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    settle: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...overrides,
  };
}

const VALID = {
  workspaceId: "ws-1",
  myShareMinorUnits: 30000n,
  accountId: "acc-1",
  categoryId: "cat-1",
  occurredOn: "2026-08-12",
  note: "Asado",
  debtors: [
    { name: "Ana", amountMinorUnits: 30000n },
    { name: "Beto", amountMinorUnits: 30000n },
  ],
};

describe("recordSplitExpense", () => {
  it("passes a validated draft with the debtor names trimmed", async () => {
    const splits = makePort();

    const result = await recordSplitExpense(
      { ...VALID, debtors: [{ name: "  Ana  ", amountMinorUnits: 30000n }] },
      { splits },
    );

    expect(result.ok).toBe(true);
    expect(splits.recordSplitExpense).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        myShareMinorUnits: 30000n,
        debtors: [{ name: "Ana", amountMinorUnits: 30000n }],
      }),
    );
  });

  it("ACCEPTS a share of zero — paying for someone else in full is real", async () => {
    // Refusing it would force recording a fake expense for yourself. The RPC skips the
    // expense row entirely in that case and the splits stand on their own.
    const splits = makePort({
      recordSplitExpense: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });

    const result = await recordSplitExpense(
      { ...VALID, myShareMinorUnits: 0n },
      { splits },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("refuses a negative share", async () => {
    const splits = makePort();

    const result = await recordSplitExpense(
      { ...VALID, myShareMinorUnits: -1n },
      { splits },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidShare");
    expect(splits.recordSplitExpense).not.toHaveBeenCalled();
  });

  it("refuses a split with nobody owing — that is an ordinary expense", async () => {
    const splits = makePort();

    const result = await recordSplitExpense(
      { ...VALID, debtors: [] },
      { splits },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("DebtorsRequired");
    expect(splits.recordSplitExpense).not.toHaveBeenCalled();
  });

  it("refuses a debtor who owes nothing rather than dropping them", async () => {
    // A row silently removed is a person the user believes they recorded.
    const splits = makePort();

    const result = await recordSplitExpense(
      {
        ...VALID,
        debtors: [
          { name: "Ana", amountMinorUnits: 30000n },
          { name: "Beto", amountMinorUnits: 0n },
        ],
      },
      { splits },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidDebtorAmount");
    expect(splits.recordSplitExpense).not.toHaveBeenCalled();
  });

  it("refuses a blank debtor name", async () => {
    const splits = makePort();

    const result = await recordSplitExpense(
      { ...VALID, debtors: [{ name: "   ", amountMinorUnits: 100n }] },
      { splits },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("DebtorNameRequired");
  });

  it("refuses a date that does not exist", async () => {
    const splits = makePort();

    const result = await recordSplitExpense(
      { ...VALID, occurredOn: "2026-02-30" },
      { splits },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidDate");
  });

  it("propagates the port's refusal unchanged", async () => {
    // An observer, or an archived workspace: both arrive as NotPermitted from the RPC.
    const splits = makePort({
      recordSplitExpense: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "NotPermitted" } }),
    });

    const result = await recordSplitExpense(VALID, { splits });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("rejects a blank workspace without touching the port", async () => {
    const splits = makePort();

    const result = await recordSplitExpense(
      { ...VALID, workspaceId: " " },
      { splits },
    );

    expect(result.ok).toBe(false);
    expect(splits.recordSplitExpense).not.toHaveBeenCalled();
  });
});
