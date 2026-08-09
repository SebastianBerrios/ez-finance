// page.test.tsx — the terminal notice page.
//
// The (app) layout redirects DELETED users here. This page therefore must NEVER
// redirect back to /app on a failure: /app is wrapped by that same layout, so a
// persistent lifecycle-read failure (a clobbered grant, a PostgREST
// schema-cache miss, a statement timeout) turns into ERR_TOO_MANY_REDIRECTS and
// no way into the app for every erased user.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetUser, mockRpc } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("./acknowledge-deletion.action", () => ({
  acknowledgeDeletionAction: vi.fn(async () => ({})),
}));

import DeletedPage from "./page";

const USER_ID = "11111111-1111-4111-8111-111111111111";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  mockRpc.mockResolvedValue({
    data: { state: "DELETED", finalized_at: "2026-07-25T10:00:00.000Z" },
    error: null,
  });
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("/auth/deleted", () => {
  it("shows the notice and asks the person to confirm, mutating nothing", async () => {
    render(await DeletedPage());

    expect(screen.getByRole("alert")).toHaveTextContent(
      /eliminamos tus datos/i,
    );
    expect(
      screen.getByRole("button", { name: /cerrar sesión/i }),
    ).toBeInTheDocument();
    // Only the read. Nothing was acknowledged and nobody was signed out.
    expect(mockRpc.mock.calls.map((call) => call[0])).toEqual([
      "deletion_state",
    ]);
  });

  it("renders a terminal page instead of redirecting when the read fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    render(await DeletedPage());

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /no pudimos leer el estado/i,
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("sends a live account back to the app", async () => {
    mockRpc.mockResolvedValue({ data: { state: "ACTIVE" }, error: null });

    await expect(DeletedPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/app");
  });

  it("sends an anonymous visitor to login without reading anything", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(DeletedPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/login");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
