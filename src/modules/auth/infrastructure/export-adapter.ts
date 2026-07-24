// export-adapter.ts — implements ExportPort
//
// NOT-YET-IMPLEMENTED NOTICE (slice 2a-ii):
// ExportPort requires fflate (ZIP assembly) which has not been added as a
// dependency yet, and the financial entities (transactions, budgets, accounts)
// that form the bulk of a useful export are Fase 3+.
// This adapter returns a not-implemented Result until Fase 2c-ii wires it up.
// Fase 3+ registers additional per-entity collectors here (forward-compat).
import { type ExportArtifact, type ExportPort } from "@/modules/auth/application/ports/export-port";
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result, err } from "@/shared/domain/result";

export class ExportAdapter implements ExportPort {
  // exportUserData: assembles ZIP with profiles/workspaces/members — Fase 2c-ii
  async exportUserData(
    _userId: string,
  ): Promise<Result<ExportArtifact, AuthError>> {
    // fflate dependency and full implementation ship in Fase 2c-ii.
    return err({ kind: "Unavailable" });
  }
}
