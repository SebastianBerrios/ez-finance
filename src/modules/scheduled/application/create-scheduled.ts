import { scheduledDraft } from "@/modules/scheduled/domain/scheduled-draft";
import type { ScheduledError } from "@/modules/scheduled/domain/scheduled-error";
import { err, type Result } from "@shared/domain/result";

import type { ScheduledPort, ScheduledRef } from "./ports/scheduled-port";

interface CreateScheduledInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly kind: string;
  readonly accountId: string;
  readonly amountMinorUnits: bigint;
  readonly dayOfMonth: number;
  readonly categoryId?: string;
  readonly note?: string;
}

interface CreateScheduledDeps {
  readonly scheduled: ScheduledPort;
}

/**
 * Create a scheduled transaction.
 *
 * Validates before the round trip, like every other create here. The rule it CANNOT
 * check is that the account and category belong to the workspace — that needs the
 * database, so the adapter maps the trigger's sentinel back into a kind rather than this
 * pretending to know.
 */
export async function createScheduled(
  input: CreateScheduledInput,
  deps: CreateScheduledDeps,
): Promise<Result<ScheduledRef, ScheduledError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotFound" });
  }

  const draft = scheduledDraft({
    name: input.name,
    kind: input.kind,
    accountId: input.accountId,
    amountMinorUnits: input.amountMinorUnits,
    dayOfMonth: input.dayOfMonth,
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    ...(input.note === undefined ? {} : { note: input.note }),
  });

  if (!draft.ok) return err(draft.error);

  return deps.scheduled.create(input.workspaceId, draft.value);
}
