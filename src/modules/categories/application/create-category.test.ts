import { describe, expect, it, vi } from "vitest";

import { createCategory } from "./create-category";
import type { CategoryPort } from "./ports/category-port";

function portWith(
  create: CategoryPort["create"] = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { id: "cat-1" } }),
): { categories: CategoryPort } {
  return {
    categories: {
      create,
      listByWorkspace: vi.fn(),
      archiveMany: vi.fn(),
    } as unknown as CategoryPort,
  };
}

const VALID = {
  workspaceId: "ws-1",
  name: "Mascotas",
  bucket: "need",
};

describe("createCategory", () => {
  it("passes a validated draft to the port and returns its ref", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "cat-1" } });
    const deps = portWith(create);

    const result = await createCategory(VALID, deps);

    expect(result).toEqual({ ok: true, value: { id: "cat-1" } });
    expect(create).toHaveBeenCalledWith("ws-1", {
      name: "Mascotas",
      bucket: "need",
    });
  });

  it("hands the port the TRIMMED name, not what was typed", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "cat-1" } });

    await createCategory({ ...VALID, name: "  Mascotas  " }, portWith(create));

    expect(create).toHaveBeenCalledWith("ws-1", {
      name: "Mascotas",
      bucket: "need",
    });
  });

  it("refuses an invalid draft WITHOUT touching the port", async () => {
    // The point of validating here: a bad name must not cost a round trip, and a
    // CHECK violation would come back as an opaque Postgres error.
    const create = vi.fn();

    const result = await createCategory(
      { ...VALID, name: "  " },
      portWith(create),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameRequired");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a bucket outside the engine's three", async () => {
    const create = vi.fn();

    const result = await createCategory(
      { ...VALID, bucket: "otro" },
      portWith(create),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidBucket");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a blank workspace id without touching the port", async () => {
    const create = vi.fn();

    const result = await createCategory(
      { ...VALID, workspaceId: "   " },
      portWith(create),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceNotFound");
    expect(create).not.toHaveBeenCalled();
  });

  it("passes a port failure through unchanged", async () => {
    // No remapping, no swallowing: RLS refusing the insert must reach the caller as
    // NotPermitted so the UI can say something true about it.
    const create = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "NotPermitted" } });

    const result = await createCategory(VALID, portWith(create));

    expect(result).toEqual({ ok: false, error: { kind: "NotPermitted" } });
  });
});
