// indexeddb-pending-queue.ts — implements PendingQueuePort in the browser.
//
// INDEXEDDB AND NOT localStorage, for one reason that decides it: localStorage is
// synchronous and can be wiped by the browser under storage pressure without warning.
// The queue holds money the person believes they recorded, so it goes in the store that
// is meant to survive.
//
// NO DEPENDENCY. idb-keyval and friends are three lines of value here, and every
// dependency in a service-worker-adjacent path is another thing that has to still work
// when the network does not.
import type { PendingQueuePort } from "@/modules/offline/application/ports/pending-queue-port";
import {
  pendingWrite,
  type PendingWrite,
} from "@/modules/offline/domain/pending-write";

const DB_NAME = "ez-finance-offline";
const DB_VERSION = 1;
const STORE = "pending-writes";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    // No IndexedDB at all (a very locked-down browser, or a server render): the caller
    // gets the empty case rather than an exception. See the port's note.
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A blocked open means another tab holds an older version. Not worth waiting on:
    // the drain runs again on the next reconnect.
    request.onblocked = () => resolve(null);
  });
}

function transaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * Re-validated on the way OUT, through the same domain constructor that let it in.
 *
 * A row can be years old, written by a previous version of the app, or corrupted by a
 * half-finished upgrade. Feeding that straight into the drain would send nonsense to the
 * server; dropping it here keeps one bad row from stopping the rest.
 */
function revive(raw: unknown): PendingWrite | null {
  if (typeof raw !== "object" || raw === null) return null;

  const row = raw as Record<string, unknown>;
  const created = pendingWrite.create({
    localId: typeof row["localId"] === "string" ? row["localId"] : "",
    kind: row["kind"] === "edit" ? "edit" : "record",
    workspaceId:
      typeof row["workspaceId"] === "string" ? row["workspaceId"] : "",
    queuedAt:
      typeof row["queuedAt"] === "number" ? row["queuedAt"] : Number.NaN,
    fields:
      typeof row["fields"] === "object" && row["fields"] !== null
        ? (row["fields"] as Record<string, string>)
        : {},
    ...(typeof row["baseUpdatedAt"] === "string"
      ? { baseUpdatedAt: row["baseUpdatedAt"] }
      : {}),
  });

  if (!created.ok) return null;

  // The attempt count is not part of create()'s input: it is bookkeeping the queue owns.
  const attempts = typeof row["attempts"] === "number" ? row["attempts"] : 0;
  return { ...created.value, attempts };
}

export class IndexedDbPendingQueue implements PendingQueuePort {
  async list(): Promise<readonly PendingWrite[]> {
    const db = await openDb();
    if (!db) return [];

    return new Promise((resolve) => {
      const request = transaction(db, "readonly").getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        resolve(
          rows.map(revive).filter((row): row is PendingWrite => row !== null),
        );
      };
      request.onerror = () => resolve([]);
    });
  }

  async save(write: PendingWrite): Promise<void> {
    const db = await openDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
      // `put`, so saving an incremented attempt count overwrites rather than duplicates.
      const request = transaction(db, "readwrite").put({ ...write });
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  async remove(localId: string): Promise<void> {
    const db = await openDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const request = transaction(db, "readwrite").delete(localId);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }
}
