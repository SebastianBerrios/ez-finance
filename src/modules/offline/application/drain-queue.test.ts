import { describe, expect, it, vi } from "vitest";

import {
  MAX_ATTEMPTS,
  type PendingWrite,
  pendingWrite,
} from "@/modules/offline/domain/pending-write";
import type { SyncOutcome } from "@/modules/offline/domain/sync-outcome";
import { expectOk } from "@shared/domain/result";

import { drainQueue } from "./drain-queue";
import type { PendingQueuePort } from "./ports/pending-queue-port";

function make(localId: string, queuedAt: number, attempts = 0): PendingWrite {
  const created = expectOk(
    pendingWrite.create({
      localId,
      kind: "record",
      workspaceId: "ws-1",
      queuedAt,
      fields: { amount: "10.00" },
    }),
  );
  return { ...created, attempts };
}

/** An in-memory queue: the drain's rules are about order and give-up, not storage. */
function fakeQueue(initial: readonly PendingWrite[]): PendingQueuePort & {
  contents: () => readonly PendingWrite[];
} {
  let rows = [...initial];
  return {
    list: () => Promise.resolve(rows),
    save: (write) => {
      rows = [...rows.filter((row) => row.localId !== write.localId), write];
      return Promise.resolve();
    },
    remove: (localId) => {
      rows = rows.filter((row) => row.localId !== localId);
      return Promise.resolve();
    },
    contents: () => rows,
  };
}

describe("drainQueue", () => {
  it("sends the oldest write first", async () => {
    const queue = fakeQueue([make("b", 2_000), make("a", 1_000)]);
    const sent: string[] = [];
    const send = vi.fn(async (write: PendingWrite): Promise<SyncOutcome> => {
      sent.push(write.localId);
      return { kind: "Applied" };
    });

    await drainQueue({ queue, send });

    expect(sent).toEqual(["a", "b"]);
  });

  it("removes what landed, so a second drain does not duplicate it", async () => {
    const queue = fakeQueue([make("a", 1_000)]);

    await drainQueue({
      queue,
      send: () => Promise.resolve({ kind: "Applied" }),
    });

    expect(queue.contents()).toHaveLength(0);
  });

  it("STOPS at the first unreachable write instead of skipping it", async () => {
    // Skipping ahead would send a LATER write before an earlier one, and last-write-wins
    // would then resolve in the wrong direction — the older correction would win. There
    // is also nothing to gain: unreachable means the network is gone for all of them.
    const queue = fakeQueue([make("a", 1_000), make("b", 2_000)]);
    const sent: string[] = [];
    const send = vi.fn(async (write: PendingWrite): Promise<SyncOutcome> => {
      sent.push(write.localId);
      return { kind: "Unreachable" };
    });

    await drainQueue({ queue, send });

    expect(sent).toEqual(["a"]);
    expect(queue.contents()).toHaveLength(2);
  });

  it("counts the attempt on an unreachable write", async () => {
    const queue = fakeQueue([make("a", 1_000)]);

    await drainQueue({
      queue,
      send: () => Promise.resolve({ kind: "Unreachable" }),
    });

    expect(queue.contents()[0]?.attempts).toBe(1);
  });

  it("gives up on a write that has been tried too often, and says so", async () => {
    // Otherwise everything behind it waits forever. Dropping it silently would be
    // worse than keeping it: the person would never learn the movement never arrived.
    const queue = fakeQueue([make("a", 1_000, MAX_ATTEMPTS - 1)]);

    const result = await drainQueue({
      queue,
      send: () => Promise.resolve({ kind: "Unreachable" }),
    });

    expect(queue.contents()).toHaveLength(0);
    expect(result.outcomes.some((outcome) => outcome.kind === "Rejected")).toBe(
      true,
    );
  });

  it("drops a REFUSED write and keeps draining the rest", async () => {
    // A refusal is final — the same write will be refused identically — so the queue
    // must not stall on it. The reason is carried out so the person can be told.
    const queue = fakeQueue([make("a", 1_000), make("b", 2_000)]);
    const send = vi.fn(async (write: PendingWrite): Promise<SyncOutcome> =>
      write.localId === "a"
        ? { kind: "Rejected", reason: "Elige una fecha válida." }
        : { kind: "Applied" },
    );

    const result = await drainQueue({ queue, send });

    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.contents()).toHaveLength(0);
    expect(result.outcomes).toEqual([
      { kind: "Rejected", reason: "Elige una fecha válida." },
      { kind: "Applied" },
    ]);
  });

  it("drops an edit whose row vanished rather than resurrecting it", async () => {
    const queue = fakeQueue([make("a", 1_000)]);

    const result = await drainQueue({
      queue,
      send: () => Promise.resolve({ kind: "Vanished" }),
    });

    expect(queue.contents()).toHaveLength(0);
    expect(result.outcomes).toEqual([{ kind: "Vanished" }]);
  });

  it("reports what is still waiting", async () => {
    const queue = fakeQueue([make("a", 1_000), make("b", 2_000)]);

    const result = await drainQueue({
      queue,
      send: () => Promise.resolve({ kind: "Unreachable" }),
    });

    expect(result.remaining).toBe(2);
  });

  it("does nothing, and sends nothing, on an empty queue", async () => {
    // Called on every reconnect and on every mount, so the empty case is the common
    // one: it must not cost a request.
    const queue = fakeQueue([]);
    const send = vi.fn(() => Promise.resolve<SyncOutcome>({ kind: "Applied" }));

    const result = await drainQueue({ queue, send });

    expect(send).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([]);
    expect(result.remaining).toBe(0);
  });
});
