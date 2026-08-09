import {
  type ScheduledDue,
  dueWithin,
} from "@/modules/scheduled/domain/scheduled-due";
import type { ScheduledError } from "@/modules/scheduled/domain/scheduled-error";
import { type Result, err, ok } from "@shared/domain/result";

import type { ScheduledPort } from "./ports/scheduled-port";

export type { ScheduledDue };

/**
 * How far ahead counts as "por vencer".
 *
 * Seven days, because the point of the warning is that there is still time to move
 * money — a day is not enough notice to act on and a month is not a warning, it is the
 * schedule list. It lives here rather than as a caller's argument so every screen that
 * asks the question gets the same answer.
 */
export const DUE_SOON_DAYS = 7;

interface ListDueSoonInput {
  readonly workspaceId: string;
  /** Resolved by the caller, so the server and the screen agree about today. */
  readonly today: Date;
}

interface ListDueSoonDeps {
  readonly scheduled: ScheduledPort;
}

/**
 * The schedules about to run, soonest first.
 *
 * Derived from the day of month rather than read: a schedule already stores everything
 * needed to work out its next occurrence, and adding a query for it would put a second
 * round trip on the dashboard's critical path for a figure that is arithmetic.
 *
 * In the application layer because a route or page may not import the module's domain
 * (eslint-plugin-boundaries), and because `today` belongs on the server: a client
 * deriving it from new Date() would disagree with the server render at midnight.
 */
export async function listDueSoon(
  input: ListDueSoonInput,
  deps: ListDueSoonDeps,
): Promise<Result<readonly ScheduledDue[], ScheduledError>> {
  const schedules = await deps.scheduled.listByWorkspace(input.workspaceId);

  if (!schedules.ok) return err(schedules.error);

  return ok(dueWithin(schedules.value, input.today, DUE_SOON_DAYS));
}
