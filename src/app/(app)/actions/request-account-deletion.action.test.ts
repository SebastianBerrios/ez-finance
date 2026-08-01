// request-account-deletion.action.test.ts — the destructive Server Action.
//
// A Server Action is a public endpoint: the typed-ELIMINAR gate in the form is
// ergonomics (the component says so itself), the session check and the word
// re-check HERE are the actual guards. Nothing covered them until now.
//
// The Supabase client is mocked at the seam, so the real adapters and the real
// use case run — that is what makes the error→message mapping and the
// sign-out-failure branch meaningful instead of tautological.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetUser, mockSignOut, mockRpc, mockRedirect } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockRpc: vi.fn(),
  mockRedirect: vi.fn((_url: string): never => {
    // next/navigation's redirect() throws NEXT_REDIRECT to unwind the render.
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
    rpc: mockRpc,
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import { requestAccountDeletionAction } from "./request-account-deletion.action";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const WINDOW = {
  requested_at: "2026-07-25T12:00:00+00:00",
  ends_at: "2026-08-24T12:00:00+00:00",
};

function formData(confirm: string | null): FormData {
  const data = new FormData();
  if (confirm !== null) data.set("confirm", confirm);
  return data;
}

/** Runs the action and reports the redirect instead of letting it escape. */
async function run(confirm: string | null) {
  try {
    return { state: await requestAccountDeletionAction({}, formData(confirm)) };
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") {
      return { redirectedTo: mockRedirect.mock.calls.at(-1)?.[0] };
    }
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  mockSignOut.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: WINDOW, error: null });
  mockRedirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("requestAccountDeletionAction", () => {
  it("redirects to the login notice on success", async () => {
    const result = await run("ELIMINAR");

    expect(result.redirectedTo).toBe("/login?deletion=requested");
    expect(mockRpc).toHaveBeenCalledWith("request_account_deletion");
  });

  it("signs out only this browser, never the shared fleet session", async () => {
    await run("ELIMINAR");

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("refuses without a session and never touches the deletion RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await run("ELIMINAR");

    expect(result.state?.error).toMatch(/sesión expirada/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses when the confirmation word is missing", async () => {
    const result = await run(null);

    expect(result.state?.error).toMatch(/ELIMINAR/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses when the confirmation word is wrong", async () => {
    const result = await run("eliminarme");

    expect(result.state?.error).toMatch(/ELIMINAR/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("accepts the confirmation word case-insensitively and padded", async () => {
    // The form uppercases and trims client-side; the server must agree, or the
    // button enables and the action then rejects.
    const result = await run("  eliminar  ");

    expect(result.redirectedTo).toBe("/login?deletion=requested");
  });

  it("reports an already-scheduled deletion instead of the generic error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "conflict" } });

    const result = await run("ELIMINAR");

    expect(result.state?.error).toMatch(/ya hay una eliminación programada/i);
  });

  it("maps an expired session from the RPC to the session message", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "jwt_expired" },
    });

    const result = await run("ELIMINAR");

    expect(result.state?.error).toMatch(/sesión expirada/i);
  });

  it("falls back to the generic message on an unknown failure", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "some internal provider detail" },
    });

    const result = await run("ELIMINAR");

    expect(result.state?.error).toMatch(/no pudimos procesar la solicitud/i);
    expect(result.state?.error).not.toContain("provider detail");
  });

  it("does NOT redirect when the sign-out fails, and says why", async () => {
    // Redirecting here sends an authenticated user to /login, where the
    // middleware bounces them back to /app and the notice is lost.
    mockSignOut.mockResolvedValue({ error: { message: "boom" } });

    const result = await run("ELIMINAR");

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result.state?.error).toMatch(/no pudimos cerrar tu sesión/i);
    expect(result.state?.error).toMatch(/programamos la eliminación/i);
  });
});
