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
}

export interface DeletionPort {
  getState(userId: string): Promise<Result<DeletionStatus, AuthError>>;
  request(userId: string): Promise<Result<GracePeriod, AuthError>>;
  cancel(userId: string): Promise<Result<void, AuthError>>;
}
