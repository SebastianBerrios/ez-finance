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
  const endsAt = new Date(requestedAt.getTime() + GRACE_DAYS * MS_PER_DAY);

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
export const GracePeriod = { from: makeGracePeriod } as const;
