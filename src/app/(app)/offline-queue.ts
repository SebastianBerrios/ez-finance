"use client";

// Wiring the offline queue's adapter, in the only layer allowed to.
//
// The IndexedDB queue is INFRASTRUCTURE, and eslint-plugin-boundaries keeps
// infrastructure out of every module's ui — for the usual reason: a form that knew about
// IndexedDB could not be rendered in a test, and swapping the store would mean editing
// components. The delivery layer composes, so the composition lives here.
import { pendingWriteFrom } from "@/modules/offline/application/build-pending-write";
import { type PendingKind } from "@/modules/offline/application/sync-contract";
import { IndexedDbPendingQueue } from "@/modules/offline/infrastructure/indexeddb-pending-queue";

/** Announced so the status bar can update its count without polling. */
export const QUEUED_EVENT = "ez-finance:queued";

export interface QueueWriteInput {
  readonly form: FormData;
  readonly kind: PendingKind;
  readonly workspaceId: string;
  /** The row's version when the edit form opened. Required for an edit. */
  readonly baseUpdatedAt?: string;
}

/**
 * Put one write in the queue.
 *
 * Returns false when it could not be stored, and the caller MUST show that as a failure:
 * telling someone their movement is safely queued when it is not is worse than telling
 * them to try again with a connection.
 */
export async function queueWrite(input: QueueWriteInput): Promise<boolean> {
  const created = pendingWriteFrom({
    // crypto.randomUUID is the identity a retry needs to know it is re-sending the same
    // write rather than adding a second one.
    localId: crypto.randomUUID(),
    kind: input.kind,
    workspaceId: input.workspaceId,
    queuedAt: Date.now(),
    form: input.form,
    ...(input.baseUpdatedAt === undefined
      ? {}
      : { baseUpdatedAt: input.baseUpdatedAt }),
  });

  if (!created.ok) return false;

  try {
    await new IndexedDbPendingQueue().save(created.value);
    window.dispatchEvent(new Event(QUEUED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** How many writes are still waiting. */
export async function pendingCount(): Promise<number> {
  const rows = await new IndexedDbPendingQueue().list();
  return rows.length;
}
