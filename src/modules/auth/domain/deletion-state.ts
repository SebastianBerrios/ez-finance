import { type Result, err, ok } from "@/shared/domain/result";

import { type AuthError } from "./auth-error";
import { type GracePeriod } from "./grace-period";

export type DeletionState = "none" | "pending" | "cancelled" | "executed";

/**
 * Transition: none | cancelled → pending
 * Requesting deletion from an already-pending or executed state is rejected.
 */
export function requestDeletion(
  state: DeletionState,
  _grace: GracePeriod,
): Result<DeletionState, AuthError> {
  if (state === "none" || state === "cancelled") {
    return ok("pending");
  }
  return err({ kind: "ConflictOrRejected" } satisfies AuthError);
}

/**
 * Transition: pending → cancelled
 * Only allowed when grace period has NOT expired.
 */
export function cancelDeletion(
  state: DeletionState,
  grace: GracePeriod,
  now: Date,
): Result<DeletionState, AuthError> {
  if (state !== "pending") {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  if (grace.isExpired(now)) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  return ok("cancelled");
}

/**
 * Transition: pending → executed
 * Only allowed when grace period HAS expired.
 */
export function executeDeletion(
  state: DeletionState,
  grace: GracePeriod,
  now: Date,
): Result<DeletionState, AuthError> {
  if (state !== "pending") {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  if (!grace.isExpired(now)) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }
  return ok("executed");
}
