// supabase-deletion-adapter.test.ts — unit tests for the DeletionPort adapter.
// The Supabase client is mocked, so these run in the node project with no live
// database: they pin the RPC contract (names, payload shapes) and the
// error-to-AuthError mapping.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi.fn().mockResolvedValue({ rpc: mockRpc }),
}));

import { SupabaseDeletionAdapter } from "./supabase-deletion-adapter";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const REQUESTED_AT = "2026-07-25T10:00:00.000Z";
const ENDS_AT = "2026-08-24T10:00:00.000Z";
const FINALIZED_AT = "2026-08-24T10:05:00.000Z";

function makeAdapter() {
  return new SupabaseDeletionAdapter();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getState
// ---------------------------------------------------------------------------
describe("SupabaseDeletionAdapter.getState", () => {
  it("calls the deletion_state RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: { state: "ACTIVE" }, error: null });

    await makeAdapter().getState(USER_ID);

    expect(mockRpc).toHaveBeenCalledWith("deletion_state");
  });

  it("maps an ACTIVE payload to state ACTIVE with no grace period", async () => {
    mockRpc.mockResolvedValueOnce({ data: { state: "ACTIVE" }, error: null });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("ACTIVE");
      expect(result.value.grace).toBeUndefined();
    }
  });

  it("maps a GRACE_PERIOD payload to a grace period with parsed dates", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        state: "GRACE_PERIOD",
        requested_at: REQUESTED_AT,
        ends_at: ENDS_AT,
      },
      error: null,
    });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.grace) {
      expect(result.value.state).toBe("GRACE_PERIOD");
      expect(result.value.grace.requestedAt.toISOString()).toBe(REQUESTED_AT);
      expect(result.value.grace.endsAt.toISOString()).toBe(ENDS_AT);
    } else {
      expect.fail("expected a grace period");
    }
  });

  it("keeps the database ends_at instead of recomputing it locally", async () => {
    // A request made under a different window (7 days) must be reported as-is:
    // the database value is authoritative, the domain constant is not.
    const shortEnds = "2026-08-01T10:00:00.000Z";
    mockRpc.mockResolvedValueOnce({
      data: {
        state: "GRACE_PERIOD",
        requested_at: REQUESTED_AT,
        ends_at: shortEnds,
      },
      error: null,
    });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.grace) {
      expect(result.value.grace.endsAt.toISOString()).toBe(shortEnds);
    } else {
      expect.fail("expected a grace period");
    }
  });

  it("maps a DELETED payload to the terminal state with finalized_at", async () => {
    // DELETED is PERSISTED state, not "this call erased the data": the batch
    // worker finalizes most requests out of band, so the user's own sweep
    // returns false and the terminal notice would never be reached.
    mockRpc.mockResolvedValueOnce({
      data: { state: "DELETED", finalized_at: FINALIZED_AT },
      error: null,
    });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("DELETED");
      expect(result.value.finalizedAt?.toISOString()).toBe(FINALIZED_AT);
      expect(result.value.grace).toBeUndefined();
    }
  });

  it("still reports DELETED when finalized_at is unusable", async () => {
    // The timestamp is decoration; the terminal state is the fact. Failing the
    // read here would drop the user back into a silently re-provisioned account.
    mockRpc.mockResolvedValueOnce({
      data: { state: "DELETED", finalized_at: "not-a-date" },
      error: null,
    });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("DELETED");
      expect(result.value.finalizedAt).toBeUndefined();
    }
  });

  it("maps a session_not_found error to SessionExpired", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "session_not_found", code: "P0001" },
    });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
  });

  it("maps a missing payload to Unavailable", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("maps an unrecognized state value to Unavailable", async () => {
    mockRpc.mockResolvedValueOnce({ data: { state: "WAT" }, error: null });

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("maps a thrown transport failure to Unavailable", async () => {
    mockRpc.mockRejectedValueOnce(new Error("network down"));

    const result = await makeAdapter().getState(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});

// ---------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------
describe("SupabaseDeletionAdapter.request", () => {
  it("calls the request_account_deletion RPC and returns the grace period", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { requested_at: REQUESTED_AT, ends_at: ENDS_AT },
      error: null,
    });

    const result = await makeAdapter().request(USER_ID);

    expect(mockRpc).toHaveBeenCalledWith("request_account_deletion");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requestedAt.toISOString()).toBe(REQUESTED_AT);
      expect(result.value.endsAt.toISOString()).toBe(ENDS_AT);
    }
  });

  it("maps a conflict (request already pending) to ConflictOrRejected", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "conflict", code: "P0001" },
    });

    const result = await makeAdapter().request(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
  });

  it("maps a missing payload to Unavailable", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await makeAdapter().request(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("maps an unparseable payload to Unavailable", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { requested_at: "not-a-date", ends_at: ENDS_AT },
      error: null,
    });

    const result = await makeAdapter().request(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------
describe("SupabaseDeletionAdapter.cancel", () => {
  it("calls the cancel_account_deletion RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await makeAdapter().cancel(USER_ID);

    expect(mockRpc).toHaveBeenCalledWith("cancel_account_deletion");
    expect(result.ok).toBe(true);
  });

  it("maps a conflict (nothing to cancel, or window closed) to ConflictOrRejected", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "conflict", code: "P0001" },
    });

    const result = await makeAdapter().cancel(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
  });

  it("maps a thrown transport failure to Unavailable", async () => {
    mockRpc.mockRejectedValueOnce(new Error("network down"));

    const result = await makeAdapter().cancel(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});

// ---------------------------------------------------------------------------
// acknowledge — what ENDS the terminal state, so a later sign-in can start over
// ---------------------------------------------------------------------------
describe("SupabaseDeletionAdapter.acknowledge", () => {
  it("calls the acknowledge_deletion RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await makeAdapter().acknowledge(USER_ID);

    expect(mockRpc).toHaveBeenCalledWith("acknowledge_deletion");
    expect(result.ok).toBe(true);
  });

  it("maps a session_not_found error to SessionExpired", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "session_not_found", code: "P0001" },
    });

    const result = await makeAdapter().acknowledge(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SessionExpired");
  });

  it("maps a thrown transport failure to Unavailable", async () => {
    mockRpc.mockRejectedValueOnce(new Error("network down"));

    const result = await makeAdapter().acknowledge(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});
