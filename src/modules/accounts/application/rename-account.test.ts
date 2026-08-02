import { describe, expect, it, vi } from "vitest";

import type { AccountPort } from "./ports/account-port";
import { renameAccount } from "./rename-account";

function portWith(
  rename: AccountPort["rename"] = vi
    .fn()
    .mockResolvedValue({ ok: true, value: undefined }),
): { accounts: AccountPort } {
  return {
    accounts: {
      rename,
      create: vi.fn(),
      listByWorkspace: vi.fn(),
      listWithBalances: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn(),
    } as unknown as AccountPort,
  };
}

const VALID = { workspaceId: "ws-1", accountId: "acc-1", name: "Yape" };

describe("renameAccount", () => {
  it("passes the trimmed name to the port", async () => {
    const rename = vi.fn().mockResolvedValue({ ok: true, value: undefined });

    const result = await renameAccount(
      { ...VALID, name: "  Yape  " },
      portWith(rename),
    );

    expect(result.ok).toBe(true);
    expect(rename).toHaveBeenCalledWith("ws-1", "acc-1", "Yape");
  });

  it("refuses an empty name WITHOUT touching the port", async () => {
    const rename = vi.fn();

    const result = await renameAccount(
      { ...VALID, name: " " },
      portWith(rename),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAccountName");
    expect(rename).not.toHaveBeenCalled();
  });

  it("refuses a name past the column limit", async () => {
    const rename = vi.fn();

    const result = await renameAccount(
      { ...VALID, name: "a".repeat(81) },
      portWith(rename),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAccountName");
    expect(rename).not.toHaveBeenCalled();
  });

  it("accepts a name at exactly the limit, so the two paths agree", async () => {
    // NAME_MAX is imported from the draft rather than restated. If a creation accepts
    // 80 characters and a rename rejects them, one of the two is wrong and nobody finds
    // out until a real name lands on the boundary.
    const rename = vi.fn().mockResolvedValue({ ok: true, value: undefined });

    const result = await renameAccount(
      { ...VALID, name: "a".repeat(80) },
      portWith(rename),
    );

    expect(result.ok).toBe(true);
  });

  it("passes a refusal through unchanged", async () => {
    const rename = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "NotPermitted" } });

    const result = await renameAccount(VALID, portWith(rename));

    expect(result).toEqual({ ok: false, error: { kind: "NotPermitted" } });
  });
});
