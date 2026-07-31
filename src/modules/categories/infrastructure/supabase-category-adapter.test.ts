import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockSelect, mockUpdate } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({ from: mockFrom }),
}));

import { SupabaseCategoryAdapter } from "./supabase-category-adapter";

function listReturning(result: unknown) {
  const order = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ order });
  mockSelect.mockReturnValue({ eq });
  return { eq, order };
}

/** update(...).eq('workspace_id', ...).in('id', [...]) */
function archiveReturning(result: unknown) {
  const inFilter = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ in: inFilter });
  mockUpdate.mockReturnValue({ eq });
  return { eq, inFilter };
}

describe("SupabaseCategoryAdapter.listByWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
  });

  it("maps rows, deriving archived from the timestamp", async () => {
    listReturning({
      data: [
        { id: "c1", name: "Vivienda", bucket: "need", archived_at: null },
        { id: "c2", name: "Ocio", bucket: "want", archived_at: "2026-01-01" },
      ],
      error: null,
    });

    const result = await new SupabaseCategoryAdapter().listByWorkspace("ws-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toEqual({
        id: "c1",
        name: "Vivienda",
        bucket: "need",
        archived: false,
      });
      expect(result.value[1]?.archived).toBe(true);
    }
  });

  it("keeps a null bucket as null", async () => {
    // The engine's documented unbucketed case — it must not be coerced into a
    // bucket on the way through.
    listReturning({
      data: [{ id: "c3", name: "Sin clasificar", bucket: null, archived_at: null }],
      error: null,
    });

    const result = await new SupabaseCategoryAdapter().listByWorkspace("ws-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.bucket).toBeNull();
  });

  it("scopes the query to the workspace", async () => {
    const { eq } = listReturning({ data: [], error: null });

    await new SupabaseCategoryAdapter().listByWorkspace("ws-9");

    expect(eq).toHaveBeenCalledWith("workspace_id", "ws-9");
  });
});

describe("SupabaseCategoryAdapter.archiveMany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
  });

  it("sets archived_at on the given ids", async () => {
    const { eq, inFilter } = archiveReturning({ error: null });

    const result = await new SupabaseCategoryAdapter().archiveMany("ws-1", [
      "c1",
      "c2",
    ]);

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) }),
    );
    expect(eq).toHaveBeenCalledWith("workspace_id", "ws-1");
    expect(inFilter).toHaveBeenCalledWith("id", ["c1", "c2"]);
  });

  it("ALSO scopes by workspace, not only by id", async () => {
    // RLS already blocks another workspace's rows, but relying on that alone
    // would mean a policy change silently widens this call's reach.
    const { eq } = archiveReturning({ error: null });

    await new SupabaseCategoryAdapter().archiveMany("ws-1", ["c1"]);

    expect(eq).toHaveBeenCalledWith("workspace_id", "ws-1");
  });

  it("is a no-op for an empty list, without touching the backend", async () => {
    // "Keep everything" is a valid answer at onboarding, and an unfiltered
    // UPDATE is not the way to express it.
    const result = await new SupabaseCategoryAdapter().archiveMany("ws-1", []);

    expect(result.ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("maps an RLS refusal to NotPermitted", async () => {
    archiveReturning({ error: { code: "42501" } });

    const result = await new SupabaseCategoryAdapter().archiveMany("ws-1", ["c1"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("never leaks the backend message", async () => {
    archiveReturning({
      error: { code: "23514", message: 'violates check constraint "categories_x"' },
    });

    const result = await new SupabaseCategoryAdapter().archiveMany("ws-1", ["c1"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.error)).not.toContain("categories_x");
    }
  });
});
