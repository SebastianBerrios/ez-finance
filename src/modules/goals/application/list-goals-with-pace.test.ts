import { describe, expect, it, vi } from "vitest";

import {
  goalsNeedingAttention,
  listGoalsWithPace,
} from "./list-goals-with-pace";
import type { GoalPort, GoalProgress } from "./ports/goal-port";

function makeGoal(overrides: Partial<GoalProgress> = {}): GoalProgress {
  return {
    id: "g-1",
    name: "Viaje",
    accountId: "acc-1",
    accountName: "Fondo viaje",
    targetMinorUnits: 100000n,
    savedMinorUnits: 50000n,
    targetDate: "2026-07-01",
    achieved: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePort(goals: readonly GoalProgress[]): GoalPort {
  return {
    listWithProgress: vi.fn().mockResolvedValue({ ok: true, value: goals }),
    create: vi.fn(),
    archive: vi.fn(),
  } as unknown as GoalPort;
}

const TODAY = new Date(2026, 3, 1);

describe("listGoalsWithPace", () => {
  it("attaches the pace to each goal", async () => {
    const result = await listGoalsWithPace(
      { workspaceId: "ws-1", today: TODAY },
      { goals: makePort([makeGoal()]) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.pace?.kind).toBe("ON_TRACK");
    }
  });

  it("keeps a goal whose pace cannot be computed, with a null pace", async () => {
    // A stored date that is not a real date is drift. The list is the only place
    // someone can see or archive the goal, so hiding it would hide the row that fixes
    // the problem.
    const result = await listGoalsWithPace(
      { workspaceId: "ws-1", today: TODAY },
      { goals: makePort([makeGoal({ targetDate: "2026-02-30" })]) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.pace).toBeNull();
    }
  });

  it("propagates a port failure unchanged", async () => {
    const goals = {
      listWithProgress: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: "Unavailable" } }),
      create: vi.fn(),
      archive: vi.fn(),
    } as unknown as GoalPort;

    const result = await listGoalsWithPace(
      { workspaceId: "ws-1", today: TODAY },
      { goals },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });
});

describe("goalsNeedingAttention", () => {
  it("keeps only the goals at risk or overdue", async () => {
    const result = await listGoalsWithPace(
      { workspaceId: "ws-1", today: TODAY },
      {
        goals: makePort([
          makeGoal({ id: "on-track", savedMinorUnits: 50000n }),
          makeGoal({ id: "at-risk", savedMinorUnits: 1000n }),
          makeGoal({ id: "achieved", savedMinorUnits: 100000n }),
          makeGoal({ id: "no-deadline", targetDate: null }),
        ]),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(goalsNeedingAttention(result.value).map((e) => e.goal.id)).toEqual(
        ["at-risk"],
      );
    }
  });

  it("does NOT flag a goal whose pace is unknown", async () => {
    // "We could not judge this" is not "this is in trouble". Alerting on drift would
    // train people to ignore the alert.
    const result = await listGoalsWithPace(
      { workspaceId: "ws-1", today: TODAY },
      { goals: makePort([makeGoal({ targetDate: "2026-02-30" })]) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(goalsNeedingAttention(result.value)).toHaveLength(0);
  });
});
