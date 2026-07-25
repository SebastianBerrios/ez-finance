// grace-period.ts — value object representing the 30-day account deletion grace window

const GRACE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface GracePeriod {
  readonly requestedAt: Date;
  readonly endsAt: Date;
  isExpired(now: Date): boolean;
  canReactivate(now: Date): boolean;
}

export function makeGracePeriod(requestedAt: Date): GracePeriod {
  return makeGracePeriodBetween(
    requestedAt,
    new Date(requestedAt.getTime() + GRACE_DAYS * MS_PER_DAY),
  );
}

/**
 * Rebuild a grace period from a PERSISTED window. The stored endsAt wins: the
 * database computes the deadline when the request is created, so a stored
 * window must never be recomputed from GRACE_DAYS (that would silently move a
 * user's deadline if the constant ever changes).
 */
export function makeGracePeriodBetween(
  requestedAt: Date,
  endsAt: Date,
): GracePeriod {
  return {
    requestedAt,
    endsAt,
    isExpired(now: Date): boolean {
      return now.getTime() >= endsAt.getTime();
    },
    canReactivate(now: Date): boolean {
      return now.getTime() < endsAt.getTime();
    },
  };
}

// Namespace-style access for ergonomics: GracePeriod.from(requestedAt)
export const GracePeriod = {
  from: makeGracePeriod,
  between: makeGracePeriodBetween,
} as const;
