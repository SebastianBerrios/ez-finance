import { describe, expect, it, vi } from "vitest";

import type { WorkspacePort } from "./ports/workspace-port";
import {
  archiveWorkspace,
  deleteWorkspace,
  renameWorkspace,
  unarchiveWorkspace,
} from "./workspace-lifecycle";

function makePort(overrides: Partial<WorkspacePort> = {}): WorkspacePort {
  return {
    listForCurrentUser: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    create: vi.fn(),
    findMembership: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { archived: false } }),
    rename: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    archive: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    unarchive: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    delete: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...overrides,
  };
}

describe("renameWorkspace", () => {
  it("trims the name through the same draft create uses", async () => {
    const workspaces = makePort();

    const result = await renameWorkspace(
      { workspaceId: "ws-1", name: "  Casa Grande  " },
      { workspaces },
    );

    expect(result.ok).toBe(true);
    expect(workspaces.rename).toHaveBeenCalledWith("ws-1", {
      name: "Casa Grande",
    });
  });

  it("refuses a blank name without a round trip", async () => {
    const workspaces = makePort();

    const result = await renameWorkspace(
      { workspaceId: "ws-1", name: "   " },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameRequired");
    expect(workspaces.rename).not.toHaveBeenCalled();
  });

  it("refuses a name past the ceiling without a round trip", async () => {
    const workspaces = makePort();

    const result = await renameWorkspace(
      { workspaceId: "ws-1", name: "x".repeat(81) },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameTooLong");
    expect(workspaces.rename).not.toHaveBeenCalled();
  });

  it("propagates the port's refusal of an archived workspace", async () => {
    // The rule lives in the database: a name is configuration and an archived
    // workspace is read-only. This use case must not soften it into success.
    const workspaces = makePort({
      rename: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "Archived" } }),
    });

    const result = await renameWorkspace(
      { workspaceId: "ws-1", name: "Otro" },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Archived");
  });
});

describe("archiveWorkspace", () => {
  it("archives through the port", async () => {
    const workspaces = makePort();

    const result = await archiveWorkspace(
      { workspaceId: "ws-1" },
      { workspaces },
    );

    expect(result.ok).toBe(true);
    expect(workspaces.archive).toHaveBeenCalledWith("ws-1");
  });

  it("rejects a blank id without touching the port", async () => {
    const workspaces = makePort();

    const result = await archiveWorkspace({ workspaceId: " " }, { workspaces });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
    expect(workspaces.archive).not.toHaveBeenCalled();
  });

  it("propagates PersonalWorkspace", async () => {
    // The anchor bootstrap() resolves. Archiving it would leave someone whose only
    // space is read-only with nowhere to record anything.
    const workspaces = makePort({
      archive: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "PersonalWorkspace" } }),
    });

    const result = await archiveWorkspace(
      { workspaceId: "ws-1" },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("PersonalWorkspace");
  });
});

describe("unarchiveWorkspace", () => {
  it("unarchives through the port", async () => {
    const workspaces = makePort();

    const result = await unarchiveWorkspace(
      { workspaceId: "ws-1" },
      { workspaces },
    );

    expect(result.ok).toBe(true);
    expect(workspaces.unarchive).toHaveBeenCalledWith("ws-1");
  });

  it("rejects a blank id without touching the port", async () => {
    const workspaces = makePort();

    const result = await unarchiveWorkspace(
      { workspaceId: "" },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    expect(workspaces.unarchive).not.toHaveBeenCalled();
  });
});

describe("deleteWorkspace", () => {
  it("passes the typed confirmation through untouched apart from trimming", async () => {
    // Trimmed here AND compared after btrim in the RPC: the stored name is
    // btrimmed at write time, so an invisible trailing space must not be the
    // reason someone cannot delete their own space.
    const workspaces = makePort();

    const result = await deleteWorkspace(
      { workspaceId: "ws-1", confirmName: "  Casa Grande  " },
      { workspaces },
    );

    expect(result.ok).toBe(true);
    expect(workspaces.delete).toHaveBeenCalledWith("ws-1", "Casa Grande");
  });

  it("refuses an empty confirmation without a round trip", async () => {
    // Not the same as a wrong name: nothing was typed. Saying so costs nothing
    // and the alternative is a generic mismatch message for an empty box.
    const workspaces = makePort();

    const result = await deleteWorkspace(
      { workspaceId: "ws-1", confirmName: "   " },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameMismatch");
    expect(workspaces.delete).not.toHaveBeenCalled();
  });

  it("propagates NotArchived — deleting requires archiving first", async () => {
    const workspaces = makePort({
      delete: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "NotArchived" } }),
    });

    const result = await deleteWorkspace(
      { workspaceId: "ws-1", confirmName: "Casa" },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotArchived");
  });

  it("propagates NameMismatch from the RPC", async () => {
    // The confirmation is checked in the DATABASE too. This use case's early
    // guard only catches an empty box; a wrong name is the RPC's answer.
    const workspaces = makePort({
      delete: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "NameMismatch" } }),
    });

    const result = await deleteWorkspace(
      { workspaceId: "ws-1", confirmName: "casa grande" },
      { workspaces },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameMismatch");
  });
});
