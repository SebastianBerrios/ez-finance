import { describe, expect, it, vi } from "vitest";

import { createAccount } from "./create-account";
import type { AccountPort } from "./ports/account-port";

function makePort(overrides: Partial<AccountPort> = {}): AccountPort {
  return {
    create: vi.fn().mockResolvedValue({ ok: true, value: { id: "acc-1" } }),
    listByWorkspace: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    listWithBalances: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    archive: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    unarchive: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...overrides,
  };
}

const INPUT = {
  workspaceId: "ws-1",
  name: "Efectivo",
  type: "cash",
  currency: "USD",
  initialBalanceMinorUnits: 0n,
};

describe("createAccount", () => {
  it("returns the new account's ref", async () => {
    const accounts = makePort();

    const result = await createAccount(INPUT, { accounts });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("acc-1");
  });

  it("hands the port a VALIDATED draft, not the raw input", async () => {
    const accounts = makePort();

    await createAccount(
      { ...INPUT, name: "  Banco  ", currency: "usd" },
      { accounts },
    );

    expect(accounts.create).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ name: "Banco", currency: "USD" }),
    );
  });

  it("never reaches the port when validation fails", async () => {
    // The point of validating here: a bad draft must not cost a round trip, and
    // must not rely on the CHECK constraint to produce the error.
    const accounts = makePort();

    const result = await createAccount({ ...INPUT, name: "  " }, { accounts });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAccountName");
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("rejects a blank workspace id without calling the port", async () => {
    const accounts = makePort();

    const result = await createAccount(
      { ...INPUT, workspaceId: "" },
      { accounts },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("WorkspaceNotFound");
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("propagates a port error unchanged", async () => {
    const accounts = makePort({
      create: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: "NotPermitted" },
      }),
    });

    const result = await createAccount(INPUT, { accounts });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });

  it("validates the type before the currency", async () => {
    // Both are wrong; the caller gets ONE error and it should be the one a form
    // reports first, so the message never contradicts the field order.
    const accounts = makePort();

    const result = await createAccount(
      { ...INPUT, type: "crypto", currency: "XYZ" },
      { accounts },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAccountType");
  });
});
