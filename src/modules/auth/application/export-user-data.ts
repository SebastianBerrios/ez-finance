import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result } from "@/shared/domain/result";

import { type ExportPort, type ExportArtifact } from "./ports/export-port";

interface ExportUserDataInput {
  userId: string;
}

interface ExportUserDataDeps {
  export: ExportPort;
}

export async function exportUserData(
  input: ExportUserDataInput,
  deps: ExportUserDataDeps,
): Promise<Result<ExportArtifact, AuthError>> {
  return deps.export.exportUserData(input.userId);
}
