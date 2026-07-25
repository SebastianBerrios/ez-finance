// cancel-account-deletion.action.test.ts — the user's way OUT of the grace
// window. If this action silently degrades, the account is deleted on schedule
// and the user believes they stopped it. Nothing covered it until now.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetUser, mockRpc, mockRevalidatePath } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockRpc: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { cancelAccountDeletionAction } from "./cancel-account-deletion.action";

const USER_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe("cancelAccountDeletionAction", () => {
  it("cancels and revalidates the account page", async () => {
    const state = await cancelAccountDeletionAction({}, new FormData());

    expect(state).toEqual({});
    expect(mockRpc).toHaveBeenCalledWith("cancel_account_deletion");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/app/settings/account");
  });

  it("refuses without a session and never touches the RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const state = await cancelAccountDeletionAction({}, new FormData());

    expect(state.error).toMatch(/sesión expirada/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("explains a closed or missing window instead of the generic error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "conflict" } });

    const state = await cancelAccountDeletionAction({}, new FormData());

    expect(state.error).toMatch(/el plazo venció o no hay una eliminación pendiente/i);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("maps an expired session from the RPC to the session message", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "jwt_expired" } });

    const state = await cancelAccountDeletionAction({}, new FormData());

    expect(state.error).toMatch(/sesión expirada/i);
  });

  it("falls back to the generic message on an unknown failure", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "some internal provider detail" },
    });

    const state = await cancelAccountDeletionAction({}, new FormData());

    expect(state.error).toMatch(/no pudimos cancelar la eliminación/i);
    expect(state.error).not.toContain("provider detail");
  });
});
