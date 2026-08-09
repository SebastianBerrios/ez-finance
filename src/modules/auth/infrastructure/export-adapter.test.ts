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

const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Two movements in the same space: one the caller recorded, one someone else did.
 *
 * The second is what makes the authorship assertions meaningful — the whole reason
 * created_by is not shipped raw is that in a shared space it is another person's
 * fleet-wide auth UUID.
 */
const TRANSACTION_ROWS = [
  {
    id: "tx-1",
    workspace_id: "ws-1",
    account_id: "acc-1",
    kind: "expense",
    base_amount: 25000,
    entered_amount: 25000,
    entered_currency: "ARS",
    exchange_rate: 1,
    occurred_on: "2026-07-15",
    category_id: "cat-1",
    note: "Feria",
    transfer_id: null,
    transfer_leg: null,
    counter_account_id: null,
    created_by: USER_ID,
    created_at: "2026-07-15T10:00:00+00:00",
  },
  {
    id: "tx-2",
    workspace_id: "ws-1",
    account_id: "acc-1",
    kind: "income",
    base_amount: 500000,
    entered_amount: 500000,
    entered_currency: "ARS",
    exchange_rate: 1,
    occurred_on: "2026-07-01",
    category_id: null,
    note: null,
    transfer_id: null,
    transfer_leg: null,
    counter_account_id: null,
    created_by: OTHER_USER_ID,
    created_at: "2026-07-01T10:00:00+00:00",
  },
];

interface TableResult {
  rows?: unknown;
  single?: unknown;
  error?: unknown;
}

/** A recorded `.eq(column, value)` call, so the test can see the WHERE clause. */
type RecordedFilter = [column: string, value: unknown];

/**
 * Minimal PostgREST builder stub: awaitable after select(), plus .single().
 * It RECORDS every .eq() instead of swallowing it — a stub that returns itself
 * makes the filters invisible, and "the archive only contains the caller's own
 * rows" is the whole security contract of this adapter.
 */
function tableStub(
  { rows = [], single = null, error = null }: TableResult,
  record: (filter: RecordedFilter) => void,
) {
  const builder = {
    eq: (column: string, value: unknown) => {
      record([column, value]);
      return builder;
    },
    single: async () => ({ data: single, error }),
    then: (
      resolve: (v: { data: unknown; error: unknown }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: rows, error }).then(resolve, reject),
  };
  return { select: () => builder };
}

/** Filters observed per table during the last exportUserData() call. */
let filters: Record<string, RecordedFilter[]>;

/** Wire every table the export reads, in any order. */
function wireTables(overrides: Record<string, TableResult> = {}) {
  const tables: Record<string, TableResult> = {
    profiles: { single: PROFILE_ROW },
    workspaces: { rows: WORKSPACE_ROWS },
    workspace_members: { rows: MEMBER_ROWS },
    accounts: { rows: [] },
    categories: { rows: [] },
    budget_configs: { rows: [] },
    transactions: { rows: TRANSACTION_ROWS },
    goals: { rows: [] },
    scheduled_transactions: { rows: [] },
    ...overrides,
  };
  filters = {};
  mockSchema.mockReturnValue({
    from: (table: string) =>
      tableStub(tables[table] ?? {}, (filter) => {
        (filters[table] ??= []).push(filter);
      }),
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
    // Eight datasets plus the profile, in both formats, plus the readme. The list is
    // asserted in FULL rather than by count: the point of this change is which datasets
    // are present, and "19 files" would pass with the movements missing.
    expect(readZip(result.value.bytes).names).toEqual([
      "LEEME.txt",
      "categorias.csv",
      "categorias.json",
      "cuentas.csv",
      "cuentas.json",
      "espacios.csv",
      "espacios.json",
      "membresias.csv",
      "membresias.json",
      "metas.csv",
      "metas.json",
      "movimientos.csv",
      "movimientos.json",
      "perfil.csv",
      "perfil.json",
      "presupuestos.csv",
      "presupuestos.json",
      "programados.csv",
      "programados.json",
    ]);
  });

  it("writes the profile as readable JSON", async () => {
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed: unknown = JSON.parse(
      readZip(result.value.bytes).text("perfil.json"),
    );
    expect(parsed).toMatchObject({
      display_name: "Ana Pérez",
      default_currency: "ARS",
    });
  });

  it("writes a CSV with a header row and one row per record", async () => {
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const csv = readZip(result.value.bytes)
      .text("espacios.csv")
      .trim()
      .split("\n");
    expect(csv[0]).toBe("id,name,type,created_at,archived_at,deleted_at");
    expect(csv[1]).toContain("Personal");
    expect(csv).toHaveLength(2);
  });

  it("scopes every dataset read to the caller", async () => {
    // workspace_members is the dangerous one: its RLS policy deliberately
    // exposes ALL members of a workspace you belong to, so without an explicit
    // filter the archive ships other people's auth UUIDs, names and roles.
    // workspaces carries no filter by design — RLS already limits it to the
    // workspaces the caller is a member of, and there is no user column.
    await new ExportAdapter().exportUserData(USER_ID);

    expect(filters["profiles"]).toEqual([["id", USER_ID]]);
    expect(filters["workspace_members"]).toEqual([["user_id", USER_ID]]);
    expect(filters["workspaces"]).toBeUndefined();
  });

  it("neutralizes values a spreadsheet would run as a formula", async () => {
    // LEEME.txt tells the user to open these in a spreadsheet, and a member
    // name is attacker-controlled text from another user.
    wireTables({
      workspace_members: {
        rows: [
          {
            member_id: "m-1",
            workspace_id: "ws-1",
            user_id: USER_ID,
            display_name_snapshot: '=HYPERLINK("http://evil.test","click")',
            role: "owner",
            joined_at: "2026-07-01T10:00:00+00:00",
          },
          {
            member_id: "m-2",
            workspace_id: "ws-1",
            user_id: USER_ID,
            display_name_snapshot: "@SUM(1+1)",
            role: "member",
            joined_at: "2026-07-01T10:00:00+00:00",
          },
          {
            member_id: "m-3",
            workspace_id: "ws-1",
            user_id: USER_ID,
            display_name_snapshot: "+49 351 0000",
            role: "member",
            joined_at: "2026-07-01T10:00:00+00:00",
          },
          {
            member_id: "m-4",
            workspace_id: "ws-1",
            user_id: USER_ID,
            display_name_snapshot: "-1234 y algo",
            role: "member",
            joined_at: "2026-07-01T10:00:00+00:00",
          },
          {
            member_id: "m-5",
            workspace_id: "ws-1",
            user_id: USER_ID,
            display_name_snapshot: "\t=1+1",
            role: "member",
            joined_at: "2026-07-01T10:00:00+00:00",
          },
        ],
      },
    });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const zip = readZip(result.value.bytes);
    const csv = zip.text("membresias.csv");

    expect(csv).toContain(`'=HYPERLINK(""http://evil.test"",""click"")`);
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain("'+49 351 0000");
    expect(csv).toContain("'-1234 y algo");
    expect(csv).toContain("'\t=1+1");
    expect(csv).not.toMatch(/(^|,)=/m);
    expect(csv).not.toMatch(/(^|,)@/m);

    // The JSON mirror keeps the untouched value: nothing is lost, only the
    // spreadsheet rendering is made inert.
    const parsed = JSON.parse(zip.text("membresias.json")) as Array<{
      display_name_snapshot: string;
    }>;
    expect(parsed[0]?.display_name_snapshot).toBe(
      '=HYPERLINK("http://evil.test","click")',
    );
  });

  it("leaves non-string values alone — a negative number is a number", async () => {
    // The guard used to stringify FIRST, so a numeric -1234 came out as the
    // text '-1234: a spreadsheet then read the column as text, and every sum,
    // sort and chart over an exported amount was quietly wrong. The formula
    // risk only exists for values a user can type; a number cannot carry one.
    wireTables({
      workspaces: {
        rows: [
          {
            id: "ws-1",
            name: "Personal",
            type: "personal",
            created_at: -1234,
            archived_at: 0,
            deleted_at: null,
          },
        ],
      },
    });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const csv = readZip(result.value.bytes).text("espacios.csv");

    expect(csv).toContain("ws-1,Personal,personal,-1234,0,\n");
    expect(csv).not.toContain("'-1234");
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

  it("includes the MOVEMENTS, which is the point of the archive", async () => {
    // The regression this whole change is about. Everything else in the archive can be
    // rebuilt from memory; a year of movements cannot, and this is the file someone
    // downloads immediately before erasing the original.
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows: unknown = JSON.parse(
      readZip(result.value.bytes).text("movimientos.json"),
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);

    const csv = readZip(result.value.bytes).text("movimientos.csv");
    expect(csv).toContain("Feria");
    expect(csv).toContain("25000");
  });

  it("does NOT ship another person's auth UUID, and says who recorded what", async () => {
    // created_by in a shared space is a fleet-wide auth UUID belonging to someone else
    // — the same reason membresias is scoped to the caller. What a person actually
    // needs is "was this mine", so the raw column is replaced by a word.
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const zip = readZip(result.value.bytes);
    const csv = zip.text("movimientos.csv");
    const json = zip.text("movimientos.json");

    expect(csv).not.toContain(OTHER_USER_ID);
    expect(json).not.toContain(OTHER_USER_ID);
    expect(csv).not.toContain("created_by");

    expect(csv.split("\n")[0]).toContain("registrado_por");
    expect(csv).toContain("vos");
    expect(csv).toContain("otra persona del espacio");
  });

  it("calls a movement whose author deleted their account 'usuario eliminado'", async () => {
    // created_by is nulled when the author erases their account (ON DELETE SET NULL),
    // and a blank cell there would read as "nobody recorded this".
    wireTables({
      transactions: {
        rows: [{ ...TRANSACTION_ROWS[0], created_by: null }],
      },
    });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readZip(result.value.bytes).text("movimientos.csv")).toContain(
      "usuario eliminado",
    );
  });

  it("ABORTS when a dataset cannot be read, rather than shipping a partial archive", async () => {
    // The failure mode that must never happen: a zip missing the movements, kept by
    // someone who then deletes their account. An error is recoverable; a silently
    // incomplete archive is not.
    wireTables({ transactions: { error: { message: "boom" } } });

    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(false);
  });

  it("builds the readme FROM the dataset list, so it cannot go stale", async () => {
    // A hand-written index of a machine-generated archive is an index that lies the
    // first time someone adds a dataset and forgets — and the reader cannot tell.
    const result = await new ExportAdapter().exportUserData(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const readme = readZip(result.value.bytes).text("LEEME.txt");
    for (const name of [
      "perfil",
      "espacios",
      "membresias",
      "cuentas",
      "categorias",
      "presupuestos",
      "movimientos",
      "metas",
      "programados",
    ]) {
      expect(readme).toContain(`${name}.json / ${name}.csv`);
    }

    // And it explains the two things a reader would otherwise get wrong: whose
    // movements are in here, and that the amounts are in minor units.
    expect(readme).toContain("registrado_por");
    expect(readme).toContain("unidad mínima");
  });
});
