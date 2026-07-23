// money.ts — pure domain value object; no IO, no React, no Supabase
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import { Result, err, ok } from "./result";

// ---------------------------------------------------------------------------
// CurrencyCode branded type
// ---------------------------------------------------------------------------

export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

// ---------------------------------------------------------------------------
// CURRENCIES table (ISO 4217 minor-unit exponents)
// ---------------------------------------------------------------------------

const CURRENCIES: Readonly<Record<string, number>> = Object.freeze({
  EUR: 2,
  USD: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
});

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return code in CURRENCIES;
}

export function exponentOf(currency: CurrencyCode): number {
  // currency is guaranteed to exist in CURRENCIES (invariant: CurrencyCode only created via make/fromMinorUnits/zero which validates isSupportedCurrency)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return CURRENCIES[currency]!;
}

// ---------------------------------------------------------------------------
// Money shape — frozen plain object, no class
// ---------------------------------------------------------------------------

export interface Money {
  readonly currency: CurrencyCode;
  readonly minorUnits: bigint; // SIGNED — negative is valid (expense remaining, etc.)
}

// Module-private constructor for internally-proven-valid values (no re-validation)
function unsafeMoney(currency: CurrencyCode, minorUnits: bigint): Money {
  return Object.freeze({ currency, minorUnits });
}

// ---------------------------------------------------------------------------
// Error types — plain data, discriminated by kind
// ---------------------------------------------------------------------------

export interface UnknownCurrencyError {
  readonly kind: "UnknownCurrency";
  readonly code: string;
}

export interface CurrencyMismatchError {
  readonly kind: "CurrencyMismatch";
  readonly left: CurrencyCode;
  readonly right: CurrencyCode;
}

export interface InvalidRateError {
  readonly kind: "InvalidRate";
  readonly reason: "zero-denominator" | "negative-denominator";
}

// ---------------------------------------------------------------------------
// Construction (validate currency code at boundary)
// ---------------------------------------------------------------------------

export function make(
  currency: string,
  minorUnits: bigint,
): Result<Money, UnknownCurrencyError> {
  if (!isSupportedCurrency(currency)) {
    return err({ kind: "UnknownCurrency", code: currency });
  }
  return ok(unsafeMoney(currency, minorUnits));
}

/** Semantic alias for make — preferred at most call sites. */
export function fromMinorUnits(
  currency: string,
  minorUnits: bigint,
): Result<Money, UnknownCurrencyError> {
  return make(currency, minorUnits);
}

export function zero(currency: string): Result<Money, UnknownCurrencyError> {
  return make(currency, 0n);
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function toMinorUnits(m: Money): bigint {
  return m.minorUnits;
}

export function isZero(m: Money): boolean {
  return m.minorUnits === 0n;
}

export function isNegative(m: Money): boolean {
  return m.minorUnits < 0n;
}

export interface MoneyParts {
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly minorUnits: bigint;
}

export function toParts(m: Money): MoneyParts {
  return {
    currency: m.currency,
    exponent: exponentOf(m.currency),
    minorUnits: m.minorUnits,
  };
}

// ---------------------------------------------------------------------------
// Same-currency algebra (guard currency MATCH only; codes valid by invariant)
// ---------------------------------------------------------------------------

export function add(
  a: Money,
  b: Money,
): Result<Money, CurrencyMismatchError> {
  if (a.currency !== b.currency) {
    return err({ kind: "CurrencyMismatch", left: a.currency, right: b.currency });
  }
  return ok(unsafeMoney(a.currency, a.minorUnits + b.minorUnits));
}

export function subtract(
  a: Money,
  b: Money,
): Result<Money, CurrencyMismatchError> {
  if (a.currency !== b.currency) {
    return err({ kind: "CurrencyMismatch", left: a.currency, right: b.currency });
  }
  return ok(unsafeMoney(a.currency, a.minorUnits - b.minorUnits));
}

export function compare(
  a: Money,
  b: Money,
): Result<-1 | 0 | 1, CurrencyMismatchError> {
  if (a.currency !== b.currency) {
    return err({ kind: "CurrencyMismatch", left: a.currency, right: b.currency });
  }
  if (a.minorUnits < b.minorUnits) return ok(-1);
  if (a.minorUnits > b.minorUnits) return ok(1);
  return ok(0);
}

/** Returns false on currency mismatch — never throws. */
export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minorUnits === b.minorUnits;
}

// ---------------------------------------------------------------------------
// Rate + makeRate
// ---------------------------------------------------------------------------

export interface Rate {
  readonly numerator: bigint;
  readonly denominator: bigint; // always > 0n by invariant
}

export function makeRate(
  numerator: bigint,
  denominator: bigint,
): Result<Rate, InvalidRateError> {
  if (denominator === 0n) {
    return err({ kind: "InvalidRate", reason: "zero-denominator" });
  }
  if (denominator < 0n) {
    return err({ kind: "InvalidRate", reason: "negative-denominator" });
  }
  return ok({ numerator, denominator });
}

// ---------------------------------------------------------------------------
// roundHalfEven — exact bigint, sign-correct (module-private)
// Denominator assumed > 0; numerator may be negative.
// ---------------------------------------------------------------------------

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const q = numerator / denominator; // bigint trunc toward zero
  const r = numerator % denominator; // sign follows numerator, |r| < denominator
  if (r === 0n) return q;
  const twiceR = (r < 0n ? -r : r) * 2n; // 2*|r|
  const absDen = denominator; // > 0
  let rounded = q;
  if (twiceR > absDen) {
    // fractional > 0.5 → away from zero
    rounded = q + (numerator < 0n ? -1n : 1n);
  } else if (twiceR === absDen) {
    // exactly 0.5 → round to even
    const isEven = q % 2n === 0n;
    if (!isEven) {
      rounded = q + (numerator < 0n ? -1n : 1n);
    }
  }
  // twiceR < absDen → truncate (q unchanged)
  return rounded;
}

// ---------------------------------------------------------------------------
// multiplyByRate — exact multiply then half-even round at the division boundary
// Half-even is applied to the ABSOLUTE VALUE (sign preserved separately)
// ---------------------------------------------------------------------------

export function multiplyByRate(m: Money, rate: Rate): Money {
  // Per design §1: raw = m.minorUnits * rate.numerator (exact bigint)
  // Then roundHalfEven applies half-even on the ABSOLUTE value of (raw / denominator),
  // with sign preserved from raw.
  const raw = m.minorUnits * rate.numerator;
  const result = roundHalfEven(raw, rate.denominator);
  return unsafeMoney(m.currency, result);
}

// ---------------------------------------------------------------------------
// allocate — largest-remainder, exact conservation, deterministic
// ---------------------------------------------------------------------------

/**
 * Distribute m.minorUnits across weights proportionally.
 * sum(result) === m.minorUnits EXACTLY (largest-remainder method).
 * Weights must be non-empty (throws otherwise — precondition).
 */
export function allocate(m: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) {
    throw new Error("allocate: weights must be non-empty");
  }

  const total = m.minorUnits;
  const W = weights.reduce((acc, w) => acc + w, 0n);
  if (W === 0n) {
    throw new Error("allocate: sum of weights must be > 0");
  }

  // Compute base allocation (trunc toward zero) and fractional remainders
  const bases: bigint[] = [];
  const fractions: bigint[] = []; // numerators of fractional parts (denominator = W)

  for (const w of weights) {
    const exact = total * w; // exact numerator
    const base = exact / W; // bigint trunc toward zero
    const frac = exact % W; // fractional numerator, may be negative
    bases.push(base);
    fractions.push(frac < 0n ? -frac : frac); // store absolute fraction
  }

  const allocated = bases.reduce((acc, b) => acc + b, 0n);
  const remainder = total - allocated; // signed; |remainder| < weights.length

  if (remainder === 0n) {
    return bases.map((b) => unsafeMoney(m.currency, b));
  }

  // Distribute |remainder| units, one at a time, to parts with largest |fraction|
  // Ties broken by lowest index (deterministic). Direction follows sign of remainder.
  const remainderAbs =
    remainder < 0n ? -remainder : remainder;
  const step = remainder < 0n ? -1n : 1n;

  // Sort indices by fraction descending, tie-break by index ascending
  const indices = Array.from({ length: weights.length }, (_, i) => i);
  indices.sort((a, b) => {
    const fa = fractions[a]!;
    const fb = fractions[b]!;
    if (fb > fa) return 1;
    if (fa > fb) return -1;
    return a - b;
  });

  const result = [...bases];
  for (let i = 0n; i < remainderAbs; i++) {
    const idx = indices[Number(i)]!;
    result[idx] = result[idx]! + step;
  }

  return result.map((b) => unsafeMoney(m.currency, b));
}

/** Sugar: allocate m into n equal parts. */
export function allocateEven(m: Money, n: number): Money[] {
  if (n <= 0) {
    throw new Error("allocateEven: n must be > 0");
  }
  return allocate(m, Array<bigint>(n).fill(1n));
}
