import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type DeletionState } from "@/modules/auth/domain/deletion-state";
import { type GracePeriod } from "@/modules/auth/domain/grace-period";
import { type Result } from "@/shared/domain/result";

/**
 * Read model for the account lifecycle: the state machine value plus the
 * persisted window when one is open. `grace` is present if and only if
 * `state` is "GRACE_PERIOD" — callers need the deadline to render the
 * countdown and to evaluate the domain guards (isExpired / canReactivate).
 */
export interface DeletionStatus {
  readonly state: DeletionState;
  readonly grace?: GracePeriod;
  /** Set if and only if `state` is "DELETED": when the erasure actually ran. */
  readonly finalizedAt?: Date;
}

export interface DeletionPort {
  getState(userId: string): Promise<Result<DeletionStatus, AuthError>>;
  request(userId: string): Promise<Result<GracePeriod, AuthError>>;
  cancel(userId: string): Promise<Result<void, AuthError>>;
  /**
   * Mark a finalized erasure as seen by its owner.
   *
   * DELETED is reported from PERSISTED state, not from "this call erased the
   * data" — otherwise a deletion finalized by the scheduled worker (the
   * dominant path) never reaches the person it happened to. Acknowledging is
   * therefore what ENDS the terminal state, so a deliberate later sign-in can
   * start a fresh account. Idempotent.
   */
  acknowledge(userId: string): Promise<Result<void, AuthError>>;
}
