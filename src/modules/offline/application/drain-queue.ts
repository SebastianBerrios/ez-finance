import {
  drainOrder,
  nextAttempt,
  pendingWrite,
  type PendingWrite,
} from "@/modules/offline/domain/pending-write";
import {
  syncOutcome,
  type SyncOutcome,
} from "@/modules/offline/domain/sync-outcome";

import type { PendingQueuePort } from "./ports/pending-queue-port";

interface DrainQueueDeps {
  readonly queue: PendingQueuePort;
  /** Sends one write and reports what happened. Never throws — see the adapter. */
  readonly send: (write: PendingWrite) => Promise<SyncOutcome>;
}

export interface DrainResult {
  /** In the order they were sent, so a caller can summarise them. */
  readonly outcomes: readonly SyncOutcome[];
  /** How many writes are still queued afterwards. */
  readonly remaining: number;
}

/**
 * Send everything the person recorded offline, oldest first.
 *
 * THREE RULES, and each one is a way this could go wrong instead:
 *
 *  1. OLDEST FIRST, and STOP at the first unreachable write. Skipping ahead would send
 *     a later write before an earlier one, and last-write-wins would then resolve in the
 *     wrong direction — the older correction would win. There is nothing to gain either:
 *     unreachable means the network is gone for all of them.
 *
 *  2. A REFUSAL IS FINAL. The same write will be refused identically forever, so the
 *     queue must not stall on it. It is dropped and its reason carried out, because only
 *     the person can fix it.
 *
 *  3. GIVE UP EVENTUALLY. A write that keeps failing is reported as refused and removed,
 *     since everything behind it is waiting — and a queue that never drains is a person
 *     whose movements silently never arrive.
 */
export async function drainQueue(deps: DrainQueueDeps): Promise<DrainResult> {
  const waiting = await deps.queue.list();
  if (waiting.length === 0) return { outcomes: [], remaining: 0 };

  const outcomes: SyncOutcome[] = [];

  for (const write of drainOrder(waiting)) {
    const outcome = await deps.send(write);

    if (!syncOutcome.retryable(outcome)) {
      await deps.queue.remove(write.localId);
      outcomes.push(outcome);
      continue;
    }

    const tried = nextAttempt(write);

    if (pendingWrite.exhausted(tried)) {
      await deps.queue.remove(write.localId);
      outcomes.push({
        kind: "Rejected",
        reason:
          "no pudimos comunicarnos con el servidor después de varios intentos. Volvé a registrarlo.",
      });
      continue;
    }

    await deps.queue.save(tried);
    // Rule 1: everything after this one stays queued, in order.
    break;
  }

  const left = await deps.queue.list();
  return { outcomes, remaining: left.length };
}
