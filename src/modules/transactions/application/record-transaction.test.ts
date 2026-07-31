import { describe, expect, it, vi } from "vitest";

import type { TransactionPort } from "./ports/transaction-port";
import { recordTransaction } from "./record-transaction";

function makePort(overrides: Partial<TransactionPort> = {}): TransactionPort {
  return {
    record: vi.fn().mockResolvedValue({ ok: true, value: { id: "tx-1" } }),
    listForMonth: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    deleteOne: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
    deleteTransfer: vi.fn().mockResolvedValue({ ok: true, value: 2 }),
    ...overrides,
  };
}

const INPUT = {
  workspaceId: "ws-1",
  authorId: "user-1",
  kind: "expense",
  baseAmountMinorUnits: 2500n,
  occurredOn: "2026-07-15",
  accountId: "acc-1",
  categoryId: "cat-1",
  note: "Almuerzo",
};

describe("recordTransaction", () => {
  it("returns the new id", async () => {
    const transactions = makePort();

    const result = await recordTransaction(INPUT, { transactions });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("tx-1");
  });

  it("hands the port a validated draft and the author", async () => {
    const transactions = makePort();

    await recordTransaction(INPUT, { transactions });

    expect(transactions.record).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ kind: "expense", baseAmountMinorUnits: 2500n }),
      "user-1",
    );
  });

  it("never reaches the port when the draft is invalid", async () => {
    const transactions = makePort();

    const result = await recordTransaction(
      { ...INPUT, baseAmountMinorUnits: 0n },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAmount");
    expect(transactions.record).not.toHaveBeenCalled();
  });

  it("rejects a transfer before it can reach the database", async () => {
    const transactions = makePort();

    const result = await recordTransaction(
      { ...INPUT, kind: "transfer" },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidKind");
    expect(transactions.record).not.toHaveBeenCalled();
  });

  it("rejects a blank workspace id", async () => {
    const transactions = makePort();

    const result = await recordTransaction(
      { ...INPUT, workspaceId: " " },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceNotReady");
    expect(transactions.record).not.toHaveBeenCalled();
  });

  it("rejects a blank author id", async () => {
    // RLS requires created_by = auth.uid(), so an anonymous write cannot succeed —
    // failing here beats a policy violation the person cannot act on.
    const transactions = makePort();

    const result = await recordTransaction(
      { ...INPUT, authorId: "" },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
    expect(transactions.record).not.toHaveBeenCalled();
  });

  it("propagates a port error unchanged", async () => {
    const transactions = makePort({
      record: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "UnknownReference" } }),
    });

    const result = await recordTransaction(INPUT, { transactions });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("UnknownReference");
  });
});
