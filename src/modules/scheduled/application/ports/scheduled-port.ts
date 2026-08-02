import type { ScheduledDraft } from "@/modules/scheduled/domain/scheduled-draft";
import type { ScheduledError } from "@/modules/scheduled/domain/scheduled-error";
import type { Result } from "@shared/domain/result";

export type { ScheduledError };

export interface ScheduledRef {
  readonly id: string;
}

export interface ScheduledSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: "income" | "expense";
  readonly amountMinorUnits: bigint;
  readonly dayOfMonth: number;
  readonly accountName: string;
  readonly categoryName: string | null;
  readonly paused: boolean;
  /** Null until the worker has run for it at least once. */
  readonly materialisedThrough: string | null;
}

export interface ScheduledPort {
  listByWorkspace(
    workspaceId: string,
  ): Promise<Result<readonly ScheduledSummary[], ScheduledError>>;

  create(
    workspaceId: string,
    draft: ScheduledDraft,
  ): Promise<Result<ScheduledRef, ScheduledError>>;

  /**
   * Pause or resume. PAUSE, never delete — a schedule that ran for six months is the
   * explanation for six months of transactions, and deleting it removes the answer to
   * "why is this here?" while leaving the rows behind.
   */
  setPaused(
    workspaceId: string,
    scheduledId: string,
    paused: boolean,
  ): Promise<Result<void, ScheduledError>>;
}
