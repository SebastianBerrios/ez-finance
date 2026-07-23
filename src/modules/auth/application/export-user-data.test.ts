import { describe, expect, it, vi } from "vitest";

import { ok, err } from "@/shared/domain/result";

import { exportUserData } from "./export-user-data";
import { type ExportPort, type ExportArtifact } from "./ports/export-port";

function makeFakeExportPort(overrides: Partial<ExportPort> = {}): ExportPort {
  const fakeArtifact: ExportArtifact = {
    filename: "export.zip",
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "application/zip",
  };
  return {
    exportUserData: vi.fn().mockResolvedValue(ok(fakeArtifact)),
    ...overrides,
  };
}

describe("exportUserData use case", () => {
  it("delegates to the export port and returns ExportArtifact", async () => {
    const exportPort = makeFakeExportPort();
    const result = await exportUserData({ userId: "u1" }, { export: exportPort });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filename).toBe("export.zip");
      expect(result.value.contentType).toBe("application/zip");
    }
    expect(exportPort.exportUserData).toHaveBeenCalledWith("u1");
  });

  it("propagates port errors", async () => {
    const exportPort = makeFakeExportPort({
      exportUserData: vi.fn().mockResolvedValue(err({ kind: "Unavailable" })),
    });
    const result = await exportUserData({ userId: "u1" }, { export: exportPort });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});
