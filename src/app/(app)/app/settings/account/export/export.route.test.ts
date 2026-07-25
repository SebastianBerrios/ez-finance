// export.route.test.ts — the data-export Route Handler.
//
// A Route Handler is a public endpoint that streams personal data, so the
// session gate, the redirect-on-failure and the response headers are the
// contract. None of it was covered until now.
//
// Only the Supabase client is mocked: the real ExportAdapter runs, so the
// response body is a real archive rather than a stand-in.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetUser, mockSchema } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSchema: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    schema: mockSchema,
  }),
}));

import { GET } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const URL_UNDER_TEST = "http://localhost:3000/app/settings/account/export";

const PROFILE_ROW = {
  id: USER_ID,
  display_name: "Ana Pérez",
  photo_url: null,
  language: "es",
  default_currency: "ARS",
  created_at: "2026-07-01T10:00:00+00:00",
  updated_at: "2026-07-20T10:00:00+00:00",
};

interface TableResult {
  rows?: unknown;
  single?: unknown;
  error?: unknown;
}

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

function wireTables(overrides: Record<string, TableResult> = {}) {
  const tables: Record<string, TableResult> = {
    profiles: { single: PROFILE_ROW },
    workspaces: { rows: [] },
    workspace_members: { rows: [] },
    ...overrides,
  };
  mockSchema.mockReturnValue({
    from: (table: string) => tableStub(tables[table] ?? {}),
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // ONLY Date is faked. The handler awaits fflate's async zip(), and a blanket
  // vi.useFakeTimers() freezes setTimeout/setImmediate underneath it — this
  // suite passed purely because fflate's Node path happens not to route
  // completion through a faked timer. Pinning the export date needs Date, and
  // nothing else.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  wireTables();
});

afterEach(() => {
  vi.useRealTimers();
  consoleError.mockRestore();
});

describe("GET /app/settings/account/export", () => {
  it("redirects an unauthenticated request to login without reading anything", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(new Request(URL_UNDER_TEST));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(mockSchema).not.toHaveBeenCalled();
  });

  it("returns the archive with download and no-store headers", async () => {
    const response = await GET(new Request(URL_UNDER_TEST));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="ez-finance-datos-2026-07-25.zip"',
    );
    // Personal data must never sit in a browser or proxy cache.
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("sends the real bytes of the archive", async () => {
    const response = await GET(new Request(URL_UNDER_TEST));
    const body = new Uint8Array(await response.arrayBuffer());

    // Local file header magic — proof this is a ZIP, not an empty body.
    expect(Array.from(body.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("redirects back to the account page with a flag when the export fails", async () => {
    wireTables({ profiles: { single: null } });

    const response = await GET(new Request(URL_UNDER_TEST));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/app/settings/account?export=error",
    );
  });

  it("logs why the export failed before redirecting", async () => {
    // `?export=error` is all the user ever sees. Without a server-side log an
    // export that fails for everyone looks exactly like one that fails for
    // nobody.
    wireTables({ profiles: { single: null } });

    await GET(new Request(URL_UNDER_TEST));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("export"),
      expect.anything(),
    );
  });

  it("leaks no provider detail when the read fails", async () => {
    wireTables({
      profiles: { error: { message: "relation does not exist", code: "42P01" } },
    });

    const response = await GET(new Request(URL_UNDER_TEST));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).not.toContain("42P01");
  });
});
