import { describe, expect, it, vi } from "vitest";

import type { CategoryPort } from "./ports/category-port";
import { renameCategory } from "./rename-category";

function portWith(
  rename: CategoryPort["rename"] = vi
    .fn()
    .mockResolvedValue({ ok: true, value: undefined }),
): { categories: CategoryPort } {
  return {
    categories: {
      rename,
      create: vi.fn(),
      listByWorkspace: vi.fn(),
      archiveMany: vi.fn(),
      unarchiveMany: vi.fn(),
    } as unknown as CategoryPort,
  };
}

const VALID = { workspaceId: "ws-1", categoryId: "cat-1", name: "Mercado" };

describe("renameCategory", () => {
  it("passes the trimmed name to the port", async () => {
    const rename = vi.fn().mockResolvedValue({ ok: true, value: undefined });

    const result = await renameCategory(
      { ...VALID, name: "  Mercado  " },
      portWith(rename),
    );

    expect(result.ok).toBe(true);
    expect(rename).toHaveBeenCalledWith("ws-1", "cat-1", "Mercado");
  });

  it("refuses an empty name WITHOUT touching the port", async () => {
    const rename = vi.fn();

    const result = await renameCategory(
      { ...VALID, name: "   " },
      portWith(rename),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameRequired");
    expect(rename).not.toHaveBeenCalled();
  });

  it("refuses a name past the column limit", async () => {
    const rename = vi.fn();

    const result = await renameCategory(
      { ...VALID, name: "a".repeat(61) },
      portWith(rename),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameTooLong");
    expect(rename).not.toHaveBeenCalled();
  });

  it("refuses a blank id rather than renaming something unspecified", async () => {
    const rename = vi.fn();

    const result = await renameCategory(
      { ...VALID, categoryId: "  " },
      portWith(rename),
    );

    expect(result.ok).toBe(false);
    expect(rename).not.toHaveBeenCalled();
  });

  it("passes a refusal through unchanged", async () => {
    // NotPermitted is also what a zero-row update reports, and it must survive: it is
    // the difference between "renamed" and "silently did nothing".
    const rename = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "NotPermitted" } });

    const result = await renameCategory(VALID, portWith(rename));

    expect(result).toEqual({ ok: false, error: { kind: "NotPermitted" } });
  });
});
