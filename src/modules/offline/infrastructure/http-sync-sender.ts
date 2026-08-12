// http-sync-sender.ts — sends one queued write to /api/sync/movimientos.
//
// NEVER THROWS, and that is the contract drainQueue relies on: a rejected promise here
// would abort the whole drain and lose the outcomes already collected. Every failure
// becomes a SyncOutcome instead, and anything it cannot classify becomes Unreachable —
// the retryable one — because an unclassifiable failure is more likely a flaky network
// than a write the server will refuse forever.
import type { PendingWrite } from "@/modules/offline/domain/pending-write";
import type { SyncOutcome } from "@/modules/offline/domain/sync-outcome";

const ENDPOINT = "/api/sync/movimientos";

const KNOWN_KINDS = new Set([
  "Applied",
  "AppliedOverwriting",
  "Vanished",
  "Rejected",
  "Unreachable",
]);

function readOutcome(payload: unknown): SyncOutcome | null {
  if (typeof payload !== "object" || payload === null) return null;

  const outcome = (payload as Record<string, unknown>)["outcome"];
  if (typeof outcome !== "object" || outcome === null) return null;

  const kind = (outcome as Record<string, unknown>)["kind"];
  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) return null;

  if (kind === "Rejected") {
    const reason = (outcome as Record<string, unknown>)["reason"];
    return {
      kind: "Rejected",
      reason: typeof reason === "string" ? reason : "el servidor lo rechazó.",
    };
  }

  return { kind } as SyncOutcome;
}

export async function sendPendingWrite(
  write: PendingWrite,
): Promise<SyncOutcome> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The cookie is what authenticates it, so it has to travel.
      credentials: "same-origin",
      body: JSON.stringify({
        kind: write.kind,
        workspaceId: write.workspaceId,
        fields: write.fields,
        ...(write.baseUpdatedAt === undefined
          ? {}
          : { baseUpdatedAt: write.baseUpdatedAt }),
      }),
    });

    // A 5xx or a proxy's HTML error page is a transport problem, not a refusal: the
    // write itself was never judged, so it stays queued.
    if (!response.ok) return { kind: "Unreachable" };

    const outcome = readOutcome(await response.json());
    return outcome ?? { kind: "Unreachable" };
  } catch {
    // Offline, DNS, aborted — all the same answer: try again later.
    return { kind: "Unreachable" };
  }
}
