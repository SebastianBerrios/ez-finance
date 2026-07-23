// password.ts — opaque Password value object
// The raw value is accessible ONLY via value() for adapter handoff.
// It is NEVER logged, serialized, or exposed to the UI.

export interface Password {
  /** Returns the raw password string — for adapter handoff only. */
  value(): string;
}

export function makePassword(raw: string): Password {
  return { value: () => raw };
}
