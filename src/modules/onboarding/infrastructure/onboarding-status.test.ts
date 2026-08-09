import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/server", () => ({
  createServerClient: vi
    .fn()
    .mockResolvedValue({ from: mockFrom, rpc: mockRpc }),
}));

import { readOnboardingStatus } from "./onboarding-status";

/** from('accounts').select(...).eq(...).limit(1) */
function accountsReturning(result: unknown) {
  const limit = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select });
  return { select, eq, limit };
}

function configReturning(result: unknown) {
  mockRpc.mockResolvedValue(result);
}

/** A config row that governs the month, with a usable income. */
function usableConfig(expectedIncome = 350000) {
  return {
    data: [{ income_mode: "mayor", expected_income: expectedIncome }],
    error: null,
  };
}

describe("readOnboardingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is complete when the workspace has an account and a budget config", async () => {
    accountsReturning({ data: [{ id: "a1" }], error: null });
    configReturning(usableConfig());

    const status = await readOnboardingStatus("ws-1");

    expect(status).toEqual({
      hasAccount: true,
      hasBudgetConfig: true,
      complete: true,
    });
  });

  it("is incomplete with an account but no budget config", async () => {
    accountsReturning({ data: [{ id: "a1" }], error: null });
    configReturning({ data: [], error: null });

    const status = await readOnboardingStatus("ws-1");

    expect(status.hasAccount).toBe(true);
    expect(status.hasBudgetConfig).toBe(false);
    expect(status.complete).toBe(false);
  });

  it("is incomplete with a budget config but no account", async () => {
    accountsReturning({ data: [], error: null });
    configReturning(usableConfig());

    const status = await readOnboardingStatus("ws-1");

    expect(status.hasAccount).toBe(false);
    expect(status.complete).toBe(false);
  });

  it("does not filter out archived accounts", async () => {
    // What this step establishes is the workspace's base currency, and that is
    // permanent. Someone who archived their only account has still made that
    // choice, so sending them back through onboarding would ask a question that
    // can no longer be answered.
    //
    // Checked STRUCTURALLY — the only filter applied is workspace_id. Asserting
    // on the returned value could not tell the difference, because the mock does
    // not implement filtering.
    const { eq } = accountsReturning({ data: [{ id: "a1" }], error: null });
    configReturning(usableConfig());

    const status = await readOnboardingStatus("ws-1");

    expect(status.hasAccount).toBe(true);
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("workspace_id", "ws-1");
  });

  it("is INCOMPLETE when a config exists but its income is still zero", async () => {
    // The split step now runs FIRST, so a config can exist with the percentages
    // chosen and no income yet. That is not a configured budget: every bucket
    // target is a share of the income, so at zero the dashboard can only render
    // three empty cubes and explain nothing. Treating it as complete would let
    // someone who abandoned the wizard after step 2 land there permanently.
    accountsReturning({ data: [{ id: "a1" }], error: null });
    configReturning(usableConfig(0));

    const status = await readOnboardingStatus("ws-1");

    expect(status.hasAccount).toBe(true);
    expect(status.hasBudgetConfig).toBe(false);
    expect(status.complete).toBe(false);
  });

  it("accepts an income that PostgREST returned as a string", async () => {
    // expected_income is a bigint. supabase-js hands those back as numbers today,
    // but a string is the documented possibility for bigint columns, and a
    // `> 0` comparison against a string would silently coerce — asserting it
    // rather than trusting it.
    accountsReturning({ data: [{ id: "a1" }], error: null });
    configReturning({
      data: [{ income_mode: "mayor", expected_income: "350000" }],
      error: null,
    });

    const status = await readOnboardingStatus("ws-1");

    expect(status.hasBudgetConfig).toBe(true);
    expect(status.complete).toBe(true);
  });

  it("reports INCOMPLETE when the read fails", async () => {
    // Deliberate: an unreadable status must send the person to onboarding rather
    // than into a dashboard that cannot compute anything. Onboarding is
    // re-runnable and idempotent; a broken dashboard is a dead end.
    accountsReturning({ data: null, error: { code: "500" } });
    configReturning({ data: null, error: { code: "500" } });

    const status = await readOnboardingStatus("ws-1");

    expect(status.complete).toBe(false);
  });

  it("reports INCOMPLETE when the client throws", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("socket hang up");
    });

    const status = await readOnboardingStatus("ws-1");

    expect(status.complete).toBe(false);
  });

  it("asks the config function for the CURRENT month", async () => {
    accountsReturning({ data: [{ id: "a1" }], error: null });
    configReturning({ data: [], error: null });

    await readOnboardingStatus("ws-1");

    expect(mockRpc).toHaveBeenCalledWith(
      "budget_config_for",
      expect.objectContaining({
        p_workspace_id: "ws-1",
        // YYYY-MM-DD, so the function can truncate it to the month itself.
        p_month: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });
});
