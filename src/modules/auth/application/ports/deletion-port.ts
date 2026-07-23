import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type DeletionState } from "@/modules/auth/domain/deletion-state";
import { type GracePeriod } from "@/modules/auth/domain/grace-period";
import { type Result } from "@/shared/domain/result";

export interface DeletionPort {
  getState(userId: string): Promise<Result<DeletionState, AuthError>>;
  request(userId: string): Promise<Result<GracePeriod, AuthError>>;
  cancel(userId: string): Promise<Result<void, AuthError>>;
}
