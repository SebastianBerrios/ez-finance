import { describe, expect, it, vi } from "vitest";

import { deleteMovement } from "./delete-movement";
import type { TransactionPort } from "./ports/transaction-port";

function makePort(overrides: Partial<TransactionPort> = {}): TransactionPort {
  return {
    record: vi.fn(),
    listForMonth: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    findEditable: vi.fn(),
    update: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
    deleteTransfer: vi.fn().mockResolvedValue({ ok: true, value: 2 }),
    ...overrides,
  };
}

const SINGLE = { workspaceId: "ws-1", transactionId: "tx-1", transferId: null };

describe("deleteMovement", () => {
  it("deletes a single row through deleteOne", async () => {
    const transactions = makePort();

    const result = await deleteMovement(SINGLE, { transactions });

    expect(result.ok).toBe(true);
    expect(transactions.deleteOne).toHaveBeenCalledWith("ws-1", "tx-1");
    expect(transactions.deleteTransfer).not.toHaveBeenCalled();
  });

  it("routes a TRANSFER to deleteTransfer, never deleteOne", async () => {
    // Deleting one leg would leave a half pair: a workspace where money left an
    // account and arrived nowhere. The RPC removes both or neither.
    const transactions = makePort();

    const result = await deleteMovement(
      { ...SINGLE, transferId: "tr-9" },
      { transactions },
    );

    expect(result.ok).toBe(true);
    expect(transactions.deleteTransfer).toHaveBeenCalledWith("tr-9");
    expect(transactions.deleteOne).not.toHaveBeenCalled();
  });

  it("treats ZERO rows deleted as NotPermitted, not as success", async () => {
    // The whole reason the port returns a count. RLS refuses a DELETE by filtering
    // the row out, which affects nothing and raises nothing — so "no error" is not
    // the same as "deleted", and reporting success here would tell someone their
    // movement is gone while it is still on the next screen.
    const transactions = makePort({
      deleteOne: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
    });

    const result = await deleteMovement(SINGLE, { transactions });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("treats a transfer that removed nothing the same way", async () => {
    const transactions = makePort({
      deleteTransfer: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
    });

    const result = await deleteMovement(
      { ...SINGLE, transferId: "tr-9" },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("accepts a transfer that removed both legs", async () => {
    const transactions = makePort();

    const result = await deleteMovement(
      { ...SINGLE, transferId: "tr-9" },
      { transactions },
    );

    expect(result.ok).toBe(true);
  });

  it("propagates a port failure unchanged", async () => {
    const transactions = makePort({
      deleteOne: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "Unavailable" } }),
    });

    const result = await deleteMovement(SINGLE, { transactions });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("rejects a blank id without touching the port", async () => {
    const transactions = makePort();

    const result = await deleteMovement(
      { ...SINGLE, transactionId: " " },
      { transactions },
    );

    expect(result.ok).toBe(false);
    expect(transactions.deleteOne).not.toHaveBeenCalled();
  });
});
