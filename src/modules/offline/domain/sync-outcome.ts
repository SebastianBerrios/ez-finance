// sync-outcome.ts — pure domain: what happened to a queued write when it finally landed.
//
// THE MERGE RULE, decided with the user: LAST WRITE WINS, AND THE PERSON IS TOLD.
//
// So there is no merge screen and no rejection on conflict. A write that arrives from a
// phone replaces whatever was there — the person's phone is the last word. The only
// question this file answers is whether the replacement was SILENT, because a correction
// that disappeared without a word is indistinguishable from an app that lost it.
//
// It never asks which version is NEWER. Clocks on two devices disagree, and "is this the
// same version I started from" is answerable where "is mine newer" is a guess.

export type SyncOutcome =
  /** Landed, and nothing else had touched the row. */
  | { kind: "Applied" }
  /** Landed, replacing a change made while the device was offline. */
  | { kind: "AppliedOverwriting" }
  /** The row was deleted meanwhile. Not resurrected — that undoes a deliberate act. */
  | { kind: "Vanished" }
  /** The server refused it. Retrying will be refused identically, so it stops here. */
  | { kind: "Rejected"; reason: string }
  /** Still no network, or the server never answered. Try again later. */
  | { kind: "Unreachable" };

export interface EditVersions {
  /** `updated_at` as it was when the form opened. */
  readonly baseUpdatedAt: string;
  /** `updated_at` now — null when the row is gone. */
  readonly currentUpdatedAt: string | null;
}

/** Whether this edit replaced something, and whether there is still a row to replace. */
export function resolveEdit(versions: EditVersions): SyncOutcome {
  if (versions.currentUpdatedAt === null) return { kind: "Vanished" };

  return versions.currentUpdatedAt === versions.baseUpdatedAt
    ? { kind: "Applied" }
    : { kind: "AppliedOverwriting" };
}

/**
 * Whether the write should be sent again.
 *
 * A REFUSAL IS NOT RETRYABLE, and that is the load-bearing half. Everything queued
 * behind a write waits for it, so a write the server keeps refusing would jam the queue
 * forever — and a queue that never drains is a person whose movements silently never
 * arrive. It is surfaced and dropped instead.
 */
function retryable(outcome: SyncOutcome): boolean {
  return outcome.kind === "Unreachable";
}

/**
 * One sentence for the person, or null when there is nothing worth saying.
 *
 * SILENCE IS THE CORRECT REPORT for the ordinary case. A banner after every reconnect
 * trains people to dismiss banners, and then the one that mattered gets dismissed too.
 */
function notice(outcomes: readonly SyncOutcome[]): string | null {
  const rejected = outcomes.filter(
    (outcome): outcome is Extract<SyncOutcome, { kind: "Rejected" }> =>
      outcome.kind === "Rejected",
  );

  // The refusals first: they are the only ones the person has to DO something about.
  if (rejected.length > 0) {
    const first = rejected[0]?.reason ?? "";
    return rejected.length === 1
      ? `No pudimos guardar un movimiento: ${first}`
      : `No pudimos guardar ${rejected.length} movimientos. El primero: ${first}`;
  }

  if (outcomes.some((outcome) => outcome.kind === "Vanished")) {
    return "Uno de los movimientos que editaste sin conexión ya había sido eliminado, así que no lo restauramos.";
  }

  const overwrote = outcomes.filter(
    (outcome) => outcome.kind === "AppliedOverwriting",
  ).length;

  if (overwrote > 0) {
    // The COUNT of everything that arrived, not just what was overwritten: the person
    // wants to know their queue emptied, and the overwrite is the caveat.
    const landed = outcomes.filter(
      (outcome) =>
        outcome.kind === "Applied" || outcome.kind === "AppliedOverwriting",
    ).length;

    return `Sincronizamos ${landed} ${landed === 1 ? "movimiento" : "movimientos"}. ${
      overwrote === 1
        ? "Uno reemplazó una versión más reciente: quedó la de este dispositivo."
        : `${overwrote} reemplazaron versiones más recientes: quedaron las de este dispositivo.`
    }`;
  }

  return null;
}

export const syncOutcome = { retryable, notice } as const;
