import { type Result, err, ok } from "@/shared/domain/result";

import { type AuthError } from "./auth-error";
import { type GracePeriod } from "./grace-period";

/**
 * Account deletion state machine — aligned with the functional spec
 * (§15 / §21): an account is ACTIVE, enters a 30-day GRACE_PERIOD on a
 * deletion request, and becomes DELETED once the grace window expires and
 * the definitive deletion runs. DELETED is terminal.
 *
 * Valid transitions:
 *   ACTIVE       → GRACE_PERIOD   requestDeletion
 *   GRACE_PERIOD → ACTIVE         cancelDeletion    (user cancels, not expired)
 *   GRACE_PERIOD → ACTIVE         reactivateDeletion (guarded by canReactivate)
 *   GRACE_PERIOD → DELETED        executeDeletion   (grace expired)
 * Any other transition is rejected with a typed domain error.
 */
export type DeletionState = "ACTIVE" | "GRACE_PERIOD" | "DELETED";

/**
 * ACTIVE → GRACE_PERIOD.
 * A deletion request is only valid from the ACTIVE state; requesting again
 * while already in grace, or after definitive deletion, is rejected.
 */
export function requestDeletion(
  state: DeletionState,
  _grace: GracePeriod,
): Result<DeletionState, AuthError> {
  if (state === "ACTIVE") {
    return ok("GRACE_PERIOD");
  }
  return err({ kind: "ConflictOrRejected" } satisfies AuthError);
}

/**
 * GRACE_PERIOD → ACTIVE (user-initiated cancellation).
 * Only allowed while the grace period has NOT expired.
 */
export function cancelDeletion(
  state: DeletionState,
  grace: GracePeriod,
  now: Date,
): Result<DeletionState, AuthError> {
  if (state !== "GRACE_PERIOD") {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  if (grace.isExpired(now)) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  return ok("ACTIVE");
}

/**
 * GRACE_PERIOD → ACTIVE (reactivation).
 *
 * Modeled as its own guarded transition (the spec names cancellation and
 * reactivation distinctly, §15 REQ-DEL-03). The reactivation TRIGGER
 * (invite-accept) is Fase 3, but the pure transition is expressed now and
 * is gated by GracePeriod.canReactivate — the previously orphaned guard is
 * now wired into the state machine.
 */
export function reactivateDeletion(
  state: DeletionState,
  grace: GracePeriod,
  now: Date,
): Result<DeletionState, AuthError> {
  if (state !== "GRACE_PERIOD") {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  if (!grace.canReactivate(now)) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  return ok("ACTIVE");
}

/**
 * GRACE_PERIOD → DELETED (definitive deletion).
 * Only allowed once the grace period HAS expired. DELETED is terminal.
 */
export function executeDeletion(
  state: DeletionState,
  grace: GracePeriod,
  now: Date,
): Result<DeletionState, AuthError> {
  if (state !== "GRACE_PERIOD") {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  if (!grace.isExpired(now)) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  return ok("DELETED");
}
