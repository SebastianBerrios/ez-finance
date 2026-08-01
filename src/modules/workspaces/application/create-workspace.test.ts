import { describe, expect, it, vi } from "vitest";

import { createWorkspace } from "./create-workspace";
import type { WorkspacePort } from "./ports/workspace-port";

function portWith(
  create: WorkspacePort["create"] = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { id: "ws-2" } }),
): { workspaces: WorkspacePort } {
  return {
    workspaces: {
      create,
      listForCurrentUser: vi.fn(),
      isMember: vi.fn(),
    } as unknown as WorkspacePort,
  };
}

describe("createWorkspace", () => {
  it("passes a validated draft to the port and returns its ref", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "ws-2" } });

    const result = await createWorkspace({ name: "Negocio" }, portWith(create));

    expect(result).toEqual({ ok: true, value: { id: "ws-2" } });
    expect(create).toHaveBeenCalledWith({ name: "Negocio" });
  });

  it("hands the port the TRIMMED name", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "ws-2" } });

    await createWorkspace({ name: "  Negocio  " }, portWith(create));

    expect(create).toHaveBeenCalledWith({ name: "Negocio" });
  });

  it("refuses an invalid draft WITHOUT touching the port", async () => {
    // The RPC raises name_required as a Postgres exception; catching it here saves a
    // round trip and keeps the adapter from having to translate an error code back
    // into a field-specific message.
    const create = vi.fn();

    const result = await createWorkspace({ name: "  " }, portWith(create));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameRequired");
    expect(create).not.toHaveBeenCalled();
  });

  it("passes the cap refusal through unchanged", async () => {
    // LimitReached has to survive as its own kind: it is the one failure here a
    // person can act on, and collapsing it into Unavailable would tell them to try
    // again at something that will never work.
    const create = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "LimitReached" } });

    const result = await createWorkspace({ name: "Negocio" }, portWith(create));

    expect(result).toEqual({ ok: false, error: { kind: "LimitReached" } });
  });
});
