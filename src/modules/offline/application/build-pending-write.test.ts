import { describe, expect, it } from "vitest";

import { pendingWriteFrom } from "./build-pending-write";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.append(name, value);
  return data;
}

const BASE = {
  localId: "w-1",
  kind: "record" as const,
  workspaceId: "ws-1",
  queuedAt: 1_000,
};

describe("pendingWriteFrom", () => {
  it("carries the movement's fields", () => {
    const result = pendingWriteFrom({
      ...BASE,
      form: form({
        kind: "expense",
        amount: "25.50",
        accountId: "acc-1",
        categoryId: "cat-1",
        occurredOn: "2026-08-12",
        note: "Cena",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fields).toEqual({
      kind: "expense",
      amount: "25.50",
      accountId: "acc-1",
      categoryId: "cat-1",
      occurredOn: "2026-08-12",
      note: "Cena",
    });
  });

  it("leaves the values EXACTLY as typed", () => {
    // Not trimmed and not parsed. The server validates a queued write with the same use
    // case as an online one; cleaning up here would enforce a rule in one path only.
    const result = pendingWriteFrom({
      ...BASE,
      form: form({ amount: " 25,50 ", note: "  Cena  " }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fields["amount"]).toBe(" 25,50 ");
    expect(result.value.fields["note"]).toBe("  Cena  ");
  });

  it("does NOT carry a field the form happens to contain", () => {
    // The list is the contract with the sync route. Iterating the FormData instead would
    // ship whatever a component adds later — including things that must never travel.
    const result = pendingWriteFrom({
      ...BASE,
      form: form({ amount: "1.00", secretToken: "nope" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.fields)).toEqual(["amount"]);
  });

  it("omits a field the form does not have, rather than sending an empty one", () => {
    const result = pendingWriteFrom({
      ...BASE,
      form: form({ amount: "1.00" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("note" in result.value.fields).toBe(false);
  });

  it("carries the movement id and the base version for an edit", () => {
    const result = pendingWriteFrom({
      ...BASE,
      kind: "edit",
      baseUpdatedAt: "2026-08-12T10:00:00Z",
      form: form({ transactionId: "tx-1", amount: "1.00" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fields["transactionId"]).toBe("tx-1");
    expect(result.value.baseUpdatedAt).toBe("2026-08-12T10:00:00Z");
  });

  it("refuses an edit with no base version, so it cannot land silently", () => {
    const result = pendingWriteFrom({
      ...BASE,
      kind: "edit",
      form: form({ transactionId: "tx-1", amount: "1.00" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BaseVersionRequired");
  });
});
