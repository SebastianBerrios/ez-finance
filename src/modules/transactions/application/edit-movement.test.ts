import { describe, expect, it, vi } from "vitest";

import { editMovement } from "./edit-movement";
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

const VALID = {
  workspaceId: "ws-1",
  transactionId: "tx-1",
  transferId: null,
  kind: "expense",
  baseAmountMinorUnits: 2500n,
  occurredOn: "2026-08-07",
  accountId: "acc-1",
  categoryId: "cat-1",
  note: "Feria",
};

describe("editMovement", () => {
  it("updates through the port with a validated draft", async () => {
    const transactions = makePort();

    const result = await editMovement(VALID, { transactions });

    expect(result.ok).toBe(true);
    expect(transactions.update).toHaveBeenCalledWith("ws-1", "tx-1", {
      kind: "expense",
      baseAmountMinorUnits: 2500n,
      occurredOn: "2026-08-07",
      accountId: "acc-1",
      categoryId: "cat-1",
      note: "Feria",
    });
  });

  it("REFUSES a transfer leg, without touching the port", async () => {
    // A transfer is a tied pair (spec §5.5). Editing one leg would leave money
    // leaving an account at one amount and arriving at another — the pair would
    // stop adding up. The database refuses it too, but failing here is what makes
    // the message readable instead of "no tienes permiso".
    const transactions = makePort();

    const result = await editMovement(
      { ...VALID, transferId: "tr-9" },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("TransferNotEditable");
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it("treats ZERO rows updated as NotPermitted, not as success", async () => {
    // Same reasoning as the delete path: RLS refuses an UPDATE by filtering the
    // row out, so nothing changes and nothing is raised. Reporting success would
    // show someone an edited amount that the next read contradicts.
    const transactions = makePort({
      update: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
    });

    const result = await editMovement(VALID, { transactions });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("passes NO categoryId when the form submitted none", async () => {
    // What an expense edited into an income looks like on the wire: the category
    // select is not rendered for income, so nothing is submitted and the field
    // arrives empty. An ABSENT categoryId is what lets the adapter write NULL and
    // clear the category the row used to carry.
    //
    // Not a rule this use case invents — the engine never reads a category off an
    // income row (transfer-classifier only sums the amount), so the point is that
    // the stale value does not survive the edit, not that it would break a total.
    const transactions = makePort();

    const result = await editMovement(
      { ...VALID, kind: "income", categoryId: "" },
      { transactions },
    );

    expect(result.ok).toBe(true);
    expect(transactions.update).toHaveBeenCalledWith(
      "ws-1",
      "tx-1",
      expect.not.objectContaining({ categoryId: expect.anything() }),
    );
  });

  it("propagates a validation failure without touching the port", async () => {
    const transactions = makePort();

    const result = await editMovement(
      { ...VALID, baseAmountMinorUnits: 0n },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAmount");
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it("propagates a port failure unchanged", async () => {
    const transactions = makePort({
      update: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "Unavailable" } }),
    });

    const result = await editMovement(VALID, { transactions });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("rejects a blank id without touching the port", async () => {
    const transactions = makePort();

    const result = await editMovement(
      { ...VALID, transactionId: " " },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("UnknownReference");
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it("rejects a blank workspace without touching the port", async () => {
    const transactions = makePort();

    const result = await editMovement(
      { ...VALID, workspaceId: "" },
      { transactions },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceNotReady");
    expect(transactions.update).not.toHaveBeenCalled();
  });
});
