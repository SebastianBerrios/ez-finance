// money-input.ts — turn what a person typed into exact minor units.
//
// STRING SURGERY, NEVER ARITHMETIC. parseFloat("0.1") * 100 is
// 10.000000000000002, and this domain's whole promise is that money is exact
// (spec §3.5, "los cálculos con dinero son exactos; nunca aparecen errores de
// redondeo"). So the fractional digits are padded as TEXT and the result is built
// with BigInt, which also means an amount past a float's 2^53 survives intact.
import { err, ok, type Result } from "./result";

export type AmountInputError =
  /** Not a number at all, or shaped like something else. */
  | { readonly kind: "NotANumber" }
  /** More decimals than the currency has — rounding would move money. */
  | { readonly kind: "TooManyDecimals" };

/**
 * Digits, at most one decimal separator (either convention), optional sign.
 *
 * No thousands separators: "1,500.50" and "1.500,50" mean the same thing to a
 * human and opposite things to a parser, so the ambiguous forms are refused
 * rather than guessed at. Spaces ARE stripped first, so "1 500,50" works.
 */
const AMOUNT = /^(-?)(\d+)(?:[.,](\d+))?$/;

export function parseAmountToMinorUnits(
  raw: string,
  exponent: number,
): Result<bigint, AmountInputError> {
  // Every kind of space, including the non-breaking one a locale-formatted number
  // may carry.
  const compact = raw.replace(/[\s ]/g, "");

  const match = AMOUNT.exec(compact);
  if (!match) return err({ kind: "NotANumber" });

  const [, sign, whole, fraction = ""] = match;

  if (fraction.length > exponent) {
    // Deliberately not rounded. Silently turning 10.555 into 10.56 moves money
    // the person did not agree to move; being told is the lesser cost.
    return err({ kind: "TooManyDecimals" });
  }

  // Pad rather than multiply: "5" at exponent 2 is "50" minor units, and text
  // cannot drift the way a float can.
  const padded = fraction.padEnd(exponent, "0");
  const magnitude = BigInt(`${whole ?? "0"}${padded}`);

  // `sign === "-"` with a zero magnitude yields 0n, not -0n: BigInt has no
  // negative zero, so "-0.00" and "0.00" land on the same value by construction.
  return ok(sign === "-" ? -magnitude : magnitude);
}
