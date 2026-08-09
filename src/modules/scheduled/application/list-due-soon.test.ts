import { describe, expect, it, vi } from "vitest";

import { DUE_SOON_DAYS, listDueSoon } from "./list-due-soon";
import type { ScheduledPort, ScheduledSummary } from "./ports/scheduled-port";

function makeSummary(
  overrides: Partial<ScheduledSummary> = {},
): ScheduledSummary {
  return {
    id: "s-1",
    name: "Alquiler",
    kind: "expense",
    amountMinorUnits: 120000n,
    dayOfMonth: 5,
    accountName: "Efectivo",
    categoryName: null,
    paused: false,
    materialisedThrough: null,
    ...overrides,
  };
}

function makePort(schedules: readonly ScheduledSummary[]): ScheduledPort {
  return {
    listByWorkspace: vi.fn().mockResolvedValue({ ok: true, value: schedules }),
    create: vi.fn(),
    setPaused: vi.fn(),
  };
}

describe("listDueSoon", () => {
  it("returns the schedules inside the window, soonest first", async () => {
    const result = await listDueSoon(
      { workspaceId: "ws-1", today: new Date(2026, 7, 4) },
      {
        scheduled: makePort([
          makeSummary({ id: "later", dayOfMonth: 9 }),
          makeSummary({ id: "sooner", dayOfMonth: 5 }),
          makeSummary({ id: "outside", dayOfMonth: 25 }),
        ]),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((d) => d.id)).toEqual(["sooner", "later"]);
    }
  });

  it("uses a seven-day window", async () => {
    // Asserted so the constant cannot drift silently: a day is not enough notice to
    // move money, and a month is not a warning, it is the schedule list.
    expect(DUE_SOON_DAYS).toBe(7);
  });

  it("propagates a port failure unchanged", async () => {
    const scheduled = {
      listByWorkspace: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "Unavailable" } }),
      create: vi.fn(),
      setPaused: vi.fn(),
    } satisfies ScheduledPort;

    const result = await listDueSoon(
      { workspaceId: "ws-1", today: new Date(2026, 7, 4) },
      { scheduled },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("returns nothing when every schedule is paused", async () => {
    const result = await listDueSoon(
      { workspaceId: "ws-1", today: new Date(2026, 7, 4) },
      { scheduled: makePort([makeSummary({ dayOfMonth: 5, paused: true })]) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });
});
