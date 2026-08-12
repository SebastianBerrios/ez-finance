import { describe, expect, it, vi } from "vitest";

import type { SplitPort } from "./ports/split-port";
import { settleSplit } from "./settle-split";

function makePort(overrides: Partial<SplitPort> = {}): SplitPort {
  return {
    recordSplitExpense: vi.fn(),
    listOwed: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    settle: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...overrides,
  };
}

const VALID = {
  workspaceId: "ws-1",
  splitId: "sp-1",
  toAccountId: "acc-2",
  occurredOn: "2026-08-12",
};

describe("settleSplit", () => {
  it("settles into the account the person chose", async () => {
    // NOT the account the expense came from: someone can pay you in cash for something
    // you put on a card, and forcing the original account would record money arriving
    // where it did not.
    const splits = makePort();

    const result = await settleSplit(VALID, { splits });

    expect(result.ok).toBe(true);
    expect(splits.settle).toHaveBeenCalledWith(
      "ws-1",
      "sp-1",
      "acc-2",
      "2026-08-12",
    );
  });

  it("requires a destination account", async () => {
    const splits = makePort();

    const result = await settleSplit(
      { ...VALID, toAccountId: " " },
      { splits },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AccountRequired");
    expect(splits.settle).not.toHaveBeenCalled();
  });

  it("treats a blank split id as NotPermitted, not as a missing field", async () => {
    // An id that names nothing and one that is not yours are the same answer from the
    // caller's side, and the RPC conflates them too so ids cannot be probed.
    const splits = makePort();

    const result = await settleSplit({ ...VALID, splitId: "" }, { splits });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
    expect(splits.settle).not.toHaveBeenCalled();
  });

  it("propagates AlreadySettled from the RPC", async () => {
    // The RPC locks the row and refuses the second call, so two taps cannot both
    // transfer. This use case must not soften that into success.
    const splits = makePort({
      settle: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "AlreadySettled" } }),
    });

    const result = await settleSplit(VALID, { splits });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AlreadySettled");
  });

  it("propagates NotPermitted for an observer or an archived workspace", async () => {
    const splits = makePort({
      settle: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "NotPermitted" } }),
    });

    const result = await settleSplit(VALID, { splits });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotPermitted");
  });
});
