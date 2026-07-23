import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result } from "@/shared/domain/result";

export interface ExportArtifact {
  readonly filename: string;
  readonly bytes: Uint8Array | ReadableStream;
  readonly contentType: "application/zip";
}

export interface ExportPort {
  exportUserData(userId: string): Promise<Result<ExportArtifact, AuthError>>;
}
