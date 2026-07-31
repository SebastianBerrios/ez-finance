import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInsert, mockSelect, mockFrom } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({ from: mockFrom }),
}));

import { accountDraft } from "@/modules/accounts/domain/account-draft";
import { expectOk } from "@shared/domain/result";

import { SupabaseAccountAdapter } from "./supabase-account-adapter";

const DRAFT = expectOk(
  accountDraft.create({
    name: "Efectivo",
    type: "cash",
    currency: "USD",
    initialBalanceMinorUnits: 1500n,
  }),
);

/** insert(...).select(...).single() */
function insertChain(result: unknown) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ single });
  mockInsert.mockReturnValue({ select });
  return { select, single };
}

describe("SupabaseAccountAdapter.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ insert: mockInsert, select: mockSelect });
  });

  it("returns the new id", async () => {
    insertChain({ data: { id: "acc-9" }, error: null });

    const result = await new SupabaseAccountAdapter().create("ws-1", DRAFT);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("acc-9");
  });

  it("writes the draft's fields, with the balance as a string", async () => {
    // initial_balance is bigint. Sending a JS number would silently lose
    // precision past 2^53, so the adapter must serialise it as a string.
    insertChain({ data: { id: "acc-9" }, error: null });

    await new SupabaseAccountAdapter().create("ws-1", DRAFT);

    expect(mockFrom).toHaveBeenCalledWith("accounts");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "ws-1",
        name: "Efectivo",
        type: "cash",
        currency: "USD",
        initial_balance: "1500",
      }),
    );
  });

  it("maps an RLS refusal to NotPermitted", async () => {
    // Spec §4: only owner and admin manage accounts. PostgREST surfaces the
    // policy failure as 42501.
    insertChain({
      data: null,
      error: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });

    const result = await new SupabaseAccountAdapter().create("ws-1", DRAFT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("maps a foreign-key violation to WorkspaceNotFound", async () => {
    insertChain({
      data: null,
      error: {
        code: "23503",
        message: 'violates foreign key constraint "accounts_workspace_id_fkey"',
      },
    });

    const result = await new SupabaseAccountAdapter().create("ws-1", DRAFT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceNotFound");
  });

  it("never leaks the backend message", async () => {
    insertChain({
      data: null,
      error: {
        code: "23514",
        message: 'violates check constraint "accounts_name_check"',
      },
    });

    const result = await new SupabaseAccountAdapter().create("ws-1", DRAFT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.error)).not.toContain("accounts_name_check");
      expect(JSON.stringify(result.error)).not.toContain("check constraint");
    }
  });

  it("returns Unavailable when the call throws", async () => {
    mockInsert.mockImplementation(() => {
      throw new Error("socket hang up");
    });

    const result = await new SupabaseAccountAdapter().create("ws-1", DRAFT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});

describe("SupabaseAccountAdapter.listByWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ insert: mockInsert, select: mockSelect });
  });

  function selectChain(result: unknown) {
    const order = vi.fn().mockResolvedValue(result);
    const eq = vi.fn().mockReturnValue({ order });
    mockSelect.mockReturnValue({ eq });
    return { eq, order };
  }

  it("maps rows to summaries, deriving `archived` from the timestamp", async () => {
    selectChain({
      data: [
        {
          id: "a1",
          name: "Efectivo",
          type: "cash",
          currency: "USD",
          archived_at: null,
        },
        {
          id: "a2",
          name: "Vieja",
          type: "bank",
          currency: "USD",
          archived_at: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const result = await new SupabaseAccountAdapter().listByWorkspace("ws-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toEqual({
        id: "a1",
        name: "Efectivo",
        type: "cash",
        currency: "USD",
        archived: false,
      });
      expect(result.value[1]?.archived).toBe(true);
    }
  });

  it("scopes the query to the workspace", async () => {
    const { eq } = selectChain({ data: [], error: null });

    await new SupabaseAccountAdapter().listByWorkspace("ws-7");

    expect(eq).toHaveBeenCalledWith("workspace_id", "ws-7");
  });

  it("returns an empty list rather than an error when there are none", async () => {
    // RLS makes "no rows" and "not my workspace" indistinguishable here, and an
    // empty list is the honest answer to both.
    selectChain({ data: [], error: null });

    const result = await new SupabaseAccountAdapter().listByWorkspace("ws-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("treats a null data payload as empty", async () => {
    selectChain({ data: null, error: null });

    const result = await new SupabaseAccountAdapter().listByWorkspace("ws-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});
