// pending-write.ts — pure domain: one write the person made while offline.
//
// WHAT THIS IS AND IS NOT. It is a COURIER, not a second validator. The fields travel
// exactly as they were typed, and the same server code that checks an online submit
// checks this one when it arrives — otherwise the offline path becomes a second, laxer
// door into the database, which is how "it saved on my phone but never appeared" starts.
//
// The one thing this file owns is ORDER, and it owns it because order IS the merge rule
// the user chose: last write wins. "Last" can only mean "the order the person acted in",
// so a write with no usable timestamp cannot enter the queue at all.
import { err, ok, type Result } from "@shared/domain/result";

/** How many times a write is re-sent before it is surfaced and dropped. */
export const MAX_ATTEMPTS = 5;

export type PendingKind = "record" | "edit";

export type PendingWriteError =
  | { kind: "WorkspaceRequired" }
  | { kind: "LocalIdRequired" }
  | { kind: "InvalidTimestamp" }
  | { kind: "BaseVersionRequired" };

export interface PendingWrite {
  /**
   * Generated on the CLIENT, and the queue's identity.
   *
   * A retry has to be able to say "this is the same write again" rather than "here is
   * another one" — without it, a reconnect that half-succeeded duplicates movements.
   */
  readonly localId: string;
  readonly kind: PendingKind;
  readonly workspaceId: string;
  /** Epoch ms, and the order the person acted in. */
  readonly queuedAt: number;
  /** The form's fields, verbatim. Never parsed here. */
  readonly fields: Readonly<Record<string, string>>;
  /**
   * `transactions.updated_at` as it was when the edit form OPENED.
   *
   * Required for an edit and absent for a new movement. It is what lets the server say
   * "your phone's version replaced a change made meanwhile" instead of replacing it in
   * silence — the difference between the merge rule the person chose and data loss.
   */
  readonly baseUpdatedAt?: string;
  readonly attempts: number;
}

export interface PendingWriteInput {
  readonly localId: string;
  readonly kind: PendingKind;
  readonly workspaceId: string;
  readonly queuedAt: number;
  readonly fields: Readonly<Record<string, string>>;
  readonly baseUpdatedAt?: string;
}

function create(
  input: PendingWriteInput,
): Result<PendingWrite, PendingWriteError> {
  const localId = input.localId.trim();
  if (localId.length === 0) return err({ kind: "LocalIdRequired" });

  const workspaceId = input.workspaceId.trim();
  if (workspaceId.length === 0) return err({ kind: "WorkspaceRequired" });

  if (!Number.isFinite(input.queuedAt))
    return err({ kind: "InvalidTimestamp" });

  const baseUpdatedAt = input.baseUpdatedAt?.trim() ?? "";
  if (input.kind === "edit" && baseUpdatedAt.length === 0) {
    return err({ kind: "BaseVersionRequired" });
  }

  // Assembled key by key: exactOptionalPropertyTypes is on, and an ABSENT
  // baseUpdatedAt is not the same as one present and undefined.
  const base = {
    localId,
    kind: input.kind,
    workspaceId,
    queuedAt: input.queuedAt,
    fields: Object.freeze({ ...input.fields }),
    attempts: 0,
  };

  return ok(
    Object.freeze(
      baseUpdatedAt.length === 0 ? base : { ...base, baseUpdatedAt },
    ),
  );
}

/** True once the write has been re-sent as often as it is going to be. */
function exhausted(write: PendingWrite): boolean {
  return write.attempts >= MAX_ATTEMPTS;
}

/**
 * The order to send the queue in: oldest first.
 *
 * Ties break on localId so the same queue always drains the same way — two movements
 * recorded in the same millisecond is routine on a phone, and an unstable order would
 * make two attempts produce two different results.
 *
 * Returns a NEW array: sorting the caller's list in place would reorder the state a
 * React component is rendering from.
 */
export function drainOrder(
  writes: readonly PendingWrite[],
): readonly PendingWrite[] {
  return [...writes].sort((left, right) =>
    left.queuedAt === right.queuedAt
      ? left.localId.localeCompare(right.localId)
      : left.queuedAt - right.queuedAt,
  );
}

/** The same write, counted as tried once more. */
export function nextAttempt(write: PendingWrite): PendingWrite {
  return Object.freeze({ ...write, attempts: write.attempts + 1 });
}

export const pendingWrite = { create, exhausted } as const;
