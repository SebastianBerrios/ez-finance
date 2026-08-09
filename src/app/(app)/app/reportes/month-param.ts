// month-param.ts — the `?mes=YYYY-MM` contract, in one place.
//
// Extracted from page.tsx when the CSV download and the print view needed the same
// parsing. Three copies of "what a valid month parameter looks like" is three chances
// for the screen and the file it exports to disagree about which month they are showing.
//
// Not a "use server" module: these are pure functions, and every export of one has to
// be an async server function.

/** `YYYY-MM` → a Date on that month's first day, or null when it is not that shape. */
export function parseMonth(raw: string | undefined): Date | null {
  if (raw === undefined || !/^\d{4}-\d{2}$/.test(raw)) return null;

  const [year, month] = raw.split("-").map(Number);
  if (year === undefined || month === undefined) return null;
  if (month < 1 || month > 12) return null;

  return new Date(year, month - 1, 1);
}

/** A Date back to `YYYY-MM`, local — the same calendar the snapshot groups by. */
export function toParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** e.g. "agosto 2026". */
export function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}
