import { describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
  drainOrder,
  nextAttempt,
  pendingWrite,
} from "./pending-write";

function write(
  overrides: Partial<Parameters<typeof pendingWrite.create>[0]> = {},
) {
  return pendingWrite.create({
    localId: "w-1",
    kind: "record",
    workspaceId: "ws-1",
    queuedAt: 1_000,
    fields: { amount: "25.50", kind: "expense" },
    ...overrides,
  });
}

describe("pendingWrite.create", () => {
  it("keeps the fields verbatim, because they are what the person typed", () => {
    // NOT parsed or normalised here. The queue is a courier: the same server code that
    // validates an online submit has to validate this one, or the offline path becomes
    // a second, laxer door into the database.
    const result = write({ fields: { amount: "25,50", note: "  Cena  " } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fields).toEqual({ amount: "25,50", note: "  Cena  " });
  });

  it("refuses a write with no workspace", () => {
    const result = write({ workspaceId: " " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceRequired");
  });

  it("refuses a write with no local id", () => {
    // The local id is the queue's identity: without it a retry cannot tell whether it
    // is re-sending the same write or adding a second one.
    const result = write({ localId: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("LocalIdRequired");
  });

  it("refuses a queuedAt that is not a real instant", () => {
    // The order the person acted in IS the merge rule. A write with no usable
    // timestamp cannot be placed in that order, so it must not enter the queue.
    const result = write({ queuedAt: Number.NaN });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidTimestamp");
  });

  it("starts with zero attempts", () => {
    const result = write();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempts).toBe(0);
  });

  it("carries the base version of the row an edit is correcting", () => {
    const result = write({
      kind: "edit",
      baseUpdatedAt: "2026-08-12T10:00:00Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.baseUpdatedAt).toBe("2026-08-12T10:00:00Z");
  });

  it("refuses an edit that does not say which version it started from", () => {
    // Without it the server cannot tell whether this edit overwrote someone's change,
    // and "last write wins, and we tell you" would silently become "last write wins".
    const result = write({ kind: "edit" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BaseVersionRequired");
  });
});

describe("drainOrder", () => {
  it("sends the oldest write first", () => {
    // THE POINT OF THE WHOLE QUEUE. Last-write-wins is only meaningful if "last" means
    // the order the person acted in; draining newest-first would make an edit lose to
    // the correction it replaced.
    const a = expectWrite(write({ localId: "a", queuedAt: 3_000 }));
    const b = expectWrite(write({ localId: "b", queuedAt: 1_000 }));
    const c = expectWrite(write({ localId: "c", queuedAt: 2_000 }));

    expect(drainOrder([a, b, c]).map((w) => w.localId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("breaks a tie by local id, so the order is always the same", () => {
    // Two writes in the same millisecond is routine on a fast phone. An unstable order
    // would make the same queue produce different results on two attempts.
    const a = expectWrite(write({ localId: "b", queuedAt: 1_000 }));
    const b = expectWrite(write({ localId: "a", queuedAt: 1_000 }));

    expect(drainOrder([a, b]).map((w) => w.localId)).toEqual(["a", "b"]);
  });

  it("does not mutate the list it was given", () => {
    const a = expectWrite(write({ localId: "a", queuedAt: 2_000 }));
    const b = expectWrite(write({ localId: "b", queuedAt: 1_000 }));
    const original = [a, b];

    drainOrder(original);

    expect(original.map((w) => w.localId)).toEqual(["a", "b"]);
  });
});

describe("nextAttempt", () => {
  it("counts the attempt", () => {
    const first = expectWrite(write());

    expect(nextAttempt(first).attempts).toBe(1);
  });

  it("gives up after MAX_ATTEMPTS, so one bad write cannot jam the queue", () => {
    // A write the server keeps refusing must eventually be surfaced and removed:
    // everything queued behind it is waiting, and a queue that never drains is a
    // person whose movements silently never arrive.
    let current = expectWrite(write());
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) current = nextAttempt(current);

    expect(current.attempts).toBe(MAX_ATTEMPTS);
    expect(pendingWrite.exhausted(current)).toBe(true);
  });

  it("is not exhausted before that", () => {
    const current = nextAttempt(expectWrite(write()));

    expect(pendingWrite.exhausted(current)).toBe(false);
  });
});

function expectWrite(
  result: ReturnType<typeof pendingWrite.create>,
): Extract<ReturnType<typeof pendingWrite.create>, { ok: true }>["value"] {
  if (!result.ok)
    throw new Error(`expected a valid write: ${result.error.kind}`);
  return result.value;
}
