// export-adapter.test.ts — behavior-first tests for the data-export adapter.
// The ZIP is actually unzipped and inspected: the contract is "the user gets a
// readable archive of THEIR data", not "zipSync was called".
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockSchema } = vi.hoisted(() => ({ mockSchema: vi.fn() }));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({ schema: mockSchema }),
}));

import { ExportAdapter } from "./export-adapter";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const PROFILE_ROW = {
  id: USER_ID,
  display_name: "Ana Pérez",
  photo_url: null,
  language: "es",
  default_currency: "ARS",
  created_at: "2026-07-01T10:00:00+00:00",
  updated_at: "2026-07-20T10:00:00+00:00",
};

const WORKSPACE_ROWS = [
  {
    id: "ws-1",
    name: "Personal",
    type: "personal",
    created_at: "2026-07-01T10:00:00+00:00",
    archived_at: null,
    deleted_at: null,
  },
];

const MEMBER_ROWS = [
  {
    member_id: "m-1",
    workspace_id: "ws-1",
    user_id: USER_ID,
    display_name_snapshot: "Ana Pérez",
    role: "owner",
    joined_at: "2026-07-01T10:00:00+00:00",
  },
];

interface TableResult {
  rows?: unknown;
  single?: unknown;
  error?: unknown;
}

/** Minimal PostgREST builder stub: awaitable after select(), plus .single(). */
function tableStub({ rows = [], single = null, error = null }: TableResult) {
  const builder = {
    eq: () => builder,
    single: async () => ({ data: single, error }),
    then: (
      resolve: (v: { data: unknown; error: unknown }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: rows, error }).then(resolve, reject),
  };
  return { select: () => builder };
}

/** Wire the three tables the export reads, in any order. */
function wireTables(overrides: Record<string, TableResult> = {}) {
  const tables: Record<string, TableResult> = {
    profiles: { single: PROFILE_ROW },
    workspaces: { rows: WORKSPACE_ROWS },
    workspace_members: { rows: MEMBER_ROWS },
    ...overrides,
  };
  mockSchema.mockReturnValue({
    from: (table: string) => tableStub(tables[table] ?? {}),
  });
}

function readZip(bytes: Uint8Array | ReadableStream) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("expected in-memory bytes");
  }
  const entries = unzipSync(bytes);
  return {
    names: Object.keys(entries).sort(),
    text: (name: string) => strFromU8(entries[name] as Uint8Array),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
  wireTables();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExportAdapter.exportUserData", () => {
  it("returns a ZIP artifact named with the export date", async () => {
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentType).toBe("application/zip");
    expect(result.value.filename).toBe("ez-finance-datos-2026-07-25.zip");
  });

  it("packs a JSON and a CSV file per dataset plus a readme", async () => {
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readZip(result.value.bytes).names).toEqual([
      "LEEME.txt",
      "espacios.csv",
      "espacios.json",
      "membresias.csv",
      "membresias.json",
      "perfil.csv",
      "perfil.json",
    ]);
  });

  it("writes the profile as readable JSON", async () => {
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed: unknown = JSON.parse(readZip(result.value.bytes).text("perfil.json"));
    expect(parsed).toMatchObject({
      display_name: "Ana Pérez",
      default_currency: "ARS",
    });
  });

  it("writes a CSV with a header row and one row per record", async () => {
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const csv = readZip(result.value.bytes).text("espacios.csv").trim().split("\n");
    expect(csv[0]).toBe("id,name,type,created_at,archived_at,deleted_at");
    expect(csv[1]).toContain("Personal");
    expect(csv).toHaveLength(2);
  });

  it("escapes CSV values containing commas, quotes and newlines", async () => {
    wireTables({
      workspaces: {
        rows: [
          {
            id: "ws-1",
            name: 'Casa, "la" nueva\nlínea',
            type: "shared",
            created_at: "2026-07-01T10:00:00+00:00",
            archived_at: null,
            deleted_at: null,
          },
        ],
      },
    });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const csv = readZip(result.value.bytes).text("espacios.csv");
    expect(csv).toContain('"Casa, ""la"" nueva\nlínea"');
  });

  it("writes an empty-but-valid CSV (header only) when a dataset has no rows", async () => {
    wireTables({ workspace_members: { rows: [] } });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const zip = readZip(result.value.bytes);
    expect(zip.text("membresias.csv").trim()).toBe(
      "member_id,workspace_id,user_id,display_name_snapshot,role,joined_at",
    );
    expect(JSON.parse(zip.text("membresias.json"))).toEqual([]);
  });

  it("maps a session error to SessionExpired without producing a partial archive", async () => {
    wireTables({
      profiles: { error: { message: "jwt_expired", code: "PGRST301" } },
    });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
  });

  it("maps a missing profile to Unavailable", async () => {
    wireTables({ profiles: { single: null } });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("maps a thrown transport failure to Unavailable", async () => {
    mockSchema.mockImplementation(() => {
      throw new Error("network down");
    });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});
