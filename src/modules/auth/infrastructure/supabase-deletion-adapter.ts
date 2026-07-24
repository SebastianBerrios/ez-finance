// supabase-deletion-adapter.ts — implements DeletionPort
//
// SCHEMA MISMATCH NOTICE (slice 2a-ii):
// The ez_finance_private.deletion_requests table has NOT been migrated yet.
// This adapter depends on:
//   - ez_finance_private.deletion_requests (table — Fase 2c)
//   - SECURITY DEFINER RPCs for deletion state reads/writes (Fase 2c)
// All three DeletionPort methods return a not-yet-implemented Result until
// those objects are provisioned (Fase 2c migration).
// DO NOT pass this adapter to requestAccountDeletion use-case in production
// until the migration is applied.
import { type DeletionPort } from "@/modules/auth/application/ports/deletion-port";
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type DeletionState } from "@/modules/auth/domain/deletion-state";
import { type GracePeriod } from "@/modules/auth/domain/grace-period";
import { type Result, err } from "@/shared/domain/result";

export class SupabaseDeletionAdapter implements DeletionPort {
  // getState: reads deletion_requests row — NOT YET AVAILABLE (Fase 2c)
  async getState(_userId: string): Promise<Result<DeletionState, AuthError>> {
    // deletion_requests table ships in Fase 2c migration.
    // Returning ACTIVE (no pending request) would be wrong; return Unavailable
    // so callers know this is not yet wired.
    return err({ kind: "Unavailable" });
  }

  // request: inserts deletion_requests + closes sessions — NOT YET AVAILABLE (Fase 2c)
  async request(_userId: string): Promise<Result<GracePeriod, AuthError>> {
    return err({ kind: "Unavailable" });
  }

  // cancel: updates deletion_requests.cancelled_at — NOT YET AVAILABLE (Fase 2c)
  async cancel(_userId: string): Promise<Result<void, AuthError>> {
    return err({ kind: "Unavailable" });
  }
}
