import type { PendingWrite } from "@/modules/offline/domain/pending-write";

/**
 * The queue of writes made while offline.
 *
 * A PORT, so the drain logic is testable without a browser: IndexedDB exists only in a
 * document, and the rules worth testing (order, when to stop, when to give up) have
 * nothing to do with storage.
 *
 * Every method is total — a storage failure resolves to the empty/no-op case rather
 * than throwing. A queue that cannot be read is indistinguishable, from the drain's
 * point of view, from an empty one, and there is nothing useful it could do about it.
 */
export interface PendingQueuePort {
  /** Everything still waiting, in no particular order. */
  list(): Promise<readonly PendingWrite[]>;

  /** Add or overwrite by localId. Overwriting is how an attempt count is persisted. */
  save(write: PendingWrite): Promise<void>;

  remove(localId: string): Promise<void>;
}
