import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { expectOk } from "@shared/domain/result";
import {
  CurrencyMismatchError,
  InvalidRateError,
  UnknownCurrencyError,
  add,
  allocate,
  allocateEven,
  compare,
  equals,
  exponentOf,
  fromMinorUnits,
  isSupportedCurrency,
  isNegative,
  isZero,
  make,
  makeRate,
  multiplyByRate,
  subtract,
  toParts,
  toMinorUnits,
  zero,
} from "@shared/domain/money";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function money(currency: string, minorUnits: bigint) {
  return expectOk(fromMinorUnits(currency, minorUnits));
}

function rate(numerator: bigint, denominator: bigint) {
  return expectOk(makeRate(numerator, denominator));
}

// ---------------------------------------------------------------------------
// isSupportedCurrency / exponentOf
// ---------------------------------------------------------------------------

describe("isSupportedCurrency", () => {
  it("returns true for known currencies", () => {
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("GBP")).toBe(true);
    expect(isSupportedCurrency("JPY")).toBe(true);
    expect(isSupportedCurrency("KWD")).toBe(true);
  });

  it("returns false for unknown currency", () => {
    expect(isSupportedCurrency("UNKNOWN")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
    expect(isSupportedCurrency("XYZ")).toBe(false);
  });
});

describe("exponentOf", () => {
  it("returns 2 for EUR", () => {
    const eur = expectOk(fromMinorUnits("EUR", 100n));
    expect(exponentOf(eur.currency)).toBe(2);
  });
  it("returns 0 for JPY", () => {
    const jpy = expectOk(fromMinorUnits("JPY", 100n));
    expect(exponentOf(jpy.currency)).toBe(0);
  });
  it("returns 3 for KWD", () => {
    const kwd = expectOk(fromMinorUnits("KWD", 1000n));
    expect(exponentOf(kwd.currency)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("make / fromMinorUnits", () => {
  it("creates a Money for a valid currency", () => {
    const result = make("USD", 100n);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(100n);
    }
  });

  it("returns UnknownCurrencyError for an unknown currency code", () => {
    const result = fromMinorUnits("UNKNOWN", 1n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error as UnknownCurrencyError;
      expect(e.kind).toBe("UnknownCurrency");
      expect(e.code).toBe("UNKNOWN");
    }
  });

  it("returns UnknownCurrencyError for empty string currency", () => {
    const result = fromMinorUnits("", 1n);
    expect(result.ok).toBe(false);
  });
});

describe("zero", () => {
  it("creates a zero-amount Money (Scenario M-7)", () => {
    const result = zero("EUR");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(0n);
    }
  });

  it("returns err for unknown currency", () => {
    const result = zero("UNKNOWN");
    expect(result.ok).toBe(false);
  });
});

describe("negative amounts (Scenario M-7)", () => {
  it("accepts negative minorUnits as valid", () => {
    const result = fromMinorUnits("EUR", -500n);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(-500n);
    }
  });
});

// ---------------------------------------------------------------------------
// toMinorUnits / toParts / accessors
// ---------------------------------------------------------------------------

describe("toMinorUnits (Scenario M-6)", () => {
  it("round-trips fromMinorUnits -> toMinorUnits", () => {
    const m = money("USD", 12345n);
    expect(toMinorUnits(m)).toBe(12345n);
  });
});

describe("toParts", () => {
  it("returns correct currency, exponent, minorUnits", () => {
    const m = money("USD", 1050n);
    const parts = toParts(m);
    expect(parts.minorUnits).toBe(1050n);
    expect(parts.exponent).toBe(2);
  });

  it("returns exponent 0 for JPY", () => {
    const m = money("JPY", 500n);
    const parts = toParts(m);
    expect(parts.exponent).toBe(0);
  });
});

describe("isZero", () => {
  it("returns true when minorUnits is 0n", () => {
    expect(isZero(money("EUR", 0n))).toBe(true);
  });

  it("returns false when minorUnits is non-zero", () => {
    expect(isZero(money("EUR", 1n))).toBe(false);
    expect(isZero(money("EUR", -1n))).toBe(false);
  });
});

describe("isNegative", () => {
  it("returns true for negative amounts", () => {
    expect(isNegative(money("EUR", -1n))).toBe(true);
  });

  it("returns false for zero and positive", () => {
    expect(isNegative(money("EUR", 0n))).toBe(false);
    expect(isNegative(money("EUR", 1n))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// add / subtract
// ---------------------------------------------------------------------------

describe("add", () => {
  it("Scenario M-1: same-currency add returns ok(30n)", () => {
    const a = money("USD", 10n);
    const b = money("USD", 20n);
    const result = add(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(30n);
      expect(result.value.currency).toBe("USD");
    }
  });

  it("Scenario M-2: cross-currency add returns err(CurrencyMismatch)", () => {
    const a = money("USD", 10n);
    const b = money("EUR", 10n);
    const result = add(a, b);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error as CurrencyMismatchError;
      expect(e.kind).toBe("CurrencyMismatch");
      expect(e.left).toBe("USD");
      expect(e.right).toBe("EUR");
    }
  });

  it("Scenario M-3: no float drift — add(10n, 20n) === 30n exact", () => {
    const a = money("USD", 10n);
    const b = money("USD", 20n);
    const result = add(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(30n);
    }
  });

  it("add with negative amounts", () => {
    const a = money("EUR", 100n);
    const b = money("EUR", -30n);
    const result = add(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(70n);
    }
  });
});

describe("subtract", () => {
  it("same-currency subtract returns ok", () => {
    const a = money("USD", 100n);
    const b = money("USD", 30n);
    const result = subtract(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(70n);
    }
  });

  it("cross-currency subtract returns err", () => {
    const a = money("USD", 100n);
    const b = money("EUR", 30n);
    const result = subtract(a, b);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error as CurrencyMismatchError;
      expect(e.kind).toBe("CurrencyMismatch");
    }
  });

  it("subtract producing negative result is valid", () => {
    const a = money("USD", 10n);
    const b = money("USD", 50n);
    const result = subtract(a, b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnits).toBe(-40n);
    }
  });
});

// ---------------------------------------------------------------------------
// compare / equals
// ---------------------------------------------------------------------------

describe("compare", () => {
  it("returns ok(-1) when a < b", () => {
    const result = compare(money("USD", 10n), money("USD", 20n));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(-1);
  });

  it("returns ok(0) when a === b", () => {
    const result = compare(money("USD", 20n), money("USD", 20n));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
  });

  it("returns ok(1) when a > b", () => {
    const result = compare(money("USD", 30n), money("USD", 20n));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
  });

  it("returns err on currency mismatch", () => {
    const result = compare(money("USD", 10n), money("EUR", 10n));
    expect(result.ok).toBe(false);
  });
});

describe("equals", () => {
  it("returns true when same currency and same minorUnits", () => {
    expect(equals(money("EUR", 100n), money("EUR", 100n))).toBe(true);
  });

  it("returns false when same currency but different minorUnits", () => {
    expect(equals(money("EUR", 100n), money("EUR", 101n))).toBe(false);
  });

  it("returns false on currency mismatch (no throw)", () => {
    expect(equals(money("EUR", 100n), money("USD", 100n))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeRate + InvalidRateError
// ---------------------------------------------------------------------------

describe("makeRate", () => {
  it("creates a valid rate for positive denominator", () => {
    const result = makeRate(1n, 2n);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.numerator).toBe(1n);
      expect(result.value.denominator).toBe(2n);
    }
  });

  it("returns err(InvalidRateError) for zero denominator (edge case #4)", () => {
    const result = makeRate(1n, 0n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error as InvalidRateError;
      expect(e.kind).toBe("InvalidRate");
      expect(e.reason).toBe("zero-denominator");
    }
  });

  it("returns err(InvalidRateError) for negative denominator", () => {
    const result = makeRate(1n, -1n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error as InvalidRateError;
      expect(e.kind).toBe("InvalidRate");
      expect(e.reason).toBe("negative-denominator");
    }
  });

  it("allows negative numerator (sign lives in numerator)", () => {
    const result = makeRate(-1n, 2n);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// multiplyByRate — half-even rounding
// ---------------------------------------------------------------------------

describe("multiplyByRate", () => {
  it("Scenario M-4a: 5n * 1/2 = 2.5 -> half-even -> 2n (2 is even)", () => {
    const m = money("USD", 5n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(2n);
  });

  it("Scenario M-4b: 3n * 1/2 = 1.5 -> half-even -> 2n (ties-to-even, not half-up)", () => {
    const m = money("USD", 3n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(2n);
  });

  it("Scenario M-4c (edge case #3): negative midpoint -3n * 1/2 = -1.5 -> half-even on abs -> -2n", () => {
    const m = money("USD", -3n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(-2n);
  });

  it("exact result (no rounding needed): 6n * 1/2 = 3n", () => {
    const m = money("USD", 6n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(3n);
  });

  it("truncate toward zero when fractional < 0.5: 7n * 1/2 = 3.5 -> 4n (3.5 rounds to 4, 4 is even)", () => {
    // 7/2 = 3.5, remainder 1, 2*1=2 === 2 (denominator), so tie -> even (4 is even)
    const m = money("USD", 7n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(4n);
  });

  it("roundHalfEven table: 0.5 -> 0 (0 is even)", () => {
    // 1/2: q=0, r=1, 2*1=2===2 (tie) -> 0 is even -> stay 0
    const m = money("USD", 1n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(0n);
  });

  it("roundHalfEven table: 1.5 -> 2 (2 is even)", () => {
    // 3/2: q=1, r=1, tie -> 1 is odd -> round up to 2
    const m = money("USD", 3n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(2n);
  });

  it("roundHalfEven table: 2.5 -> 2 (2 is even)", () => {
    // 5/2: q=2, r=1, tie -> 2 is even -> stay 2
    const m = money("USD", 5n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(2n);
  });

  it("roundHalfEven table: 3.5 -> 4 (4 is even)", () => {
    // 7/2: q=3, r=1, tie -> 3 is odd -> round up to 4
    const m = money("USD", 7n);
    const r = rate(1n, 2n);
    expect(multiplyByRate(m, r).minorUnits).toBe(4n);
  });

  it("identity rate 1/1 preserves minorUnits", () => {
    const m = money("USD", 12345n);
    const r = rate(1n, 1n);
    expect(multiplyByRate(m, r).minorUnits).toBe(12345n);
  });

  it("preserves currency", () => {
    const m = money("EUR", 100n);
    const r = rate(1n, 3n);
    expect(multiplyByRate(m, r).currency).toBe("EUR");
  });

  it("roundHalfEven: positive fractional > 0.5 rounds away from zero", () => {
    // 7n * (2/3): raw = 14n, q = 4n (trunc), r = 2n, twiceR = 4n > 3n
    // → away from zero: 4 + 1 = 5
    const m = money("USD", 7n);
    const r = rate(2n, 3n);
    expect(multiplyByRate(m, r).minorUnits).toBe(5n);
  });

  it("roundHalfEven: negative fractional > 0.5 rounds away from zero", () => {
    // -7n * (2/3): raw = -14n, q = -4n (trunc), r = -2n, twiceR = 4n > 3n
    // → away from zero: -4 + (-1) = -5
    const m = money("USD", -7n);
    const r = rate(2n, 3n);
    expect(multiplyByRate(m, r).minorUnits).toBe(-5n);
  });

  it("negative rate numerator produces negative result", () => {
    // 10n * (-1/2) = -5n
    const r = expectOk(makeRate(-1n, 2n));
    const m = money("USD", 10n);
    expect(multiplyByRate(m, r).minorUnits).toBe(-5n);
  });
});

// ---------------------------------------------------------------------------
// allocate
// ---------------------------------------------------------------------------

describe("allocate", () => {
  it("Scenario M-5: allocate(100n, [1n,1n,1n]) = [34n,33n,33n]", () => {
    const m = money("USD", 100n);
    const parts = allocate(m, [1n, 1n, 1n]);
    expect(parts.map((p) => p.minorUnits)).toEqual([34n, 33n, 33n]);
    const sum = parts.reduce((acc, p) => acc + p.minorUnits, 0n);
    expect(sum).toBe(100n);
  });

  it("allocates evenly when divisible", () => {
    const m = money("USD", 90n);
    const parts = allocate(m, [1n, 1n, 1n]);
    expect(parts.map((p) => p.minorUnits)).toEqual([30n, 30n, 30n]);
  });

  it("handles weighted allocation", () => {
    const m = money("USD", 100n);
    const parts = allocate(m, [1n, 2n]);
    const sum = parts.reduce((acc, p) => acc + p.minorUnits, 0n);
    expect(sum).toBe(100n);
    // 1:2 ratio -> ~33.33 and ~66.67 -> [33n, 67n]
    expect(parts[0]!.minorUnits + parts[1]!.minorUnits).toBe(100n);
  });

  it("throws for empty weights (edge case — allocate to zero recipients)", () => {
    const m = money("USD", 100n);
    // Design §1: "require W > 0n else throw/precondition"
    expect(() => allocate(m, [])).toThrow();
  });

  it("throws when all weights are zero (sum of weights = 0)", () => {
    const m = money("USD", 100n);
    expect(() => allocate(m, [0n, 0n])).toThrow();
  });

  it("all parts share the same currency", () => {
    const m = money("EUR", 100n);
    const parts = allocate(m, [1n, 1n, 1n]);
    parts.forEach((p) => expect(p.currency).toBe("EUR"));
  });

  it("handles negative total (conservation still holds)", () => {
    const m = money("USD", -100n);
    const parts = allocate(m, [1n, 1n, 1n]);
    const sum = parts.reduce((acc, p) => acc + p.minorUnits, 0n);
    expect(sum).toBe(-100n);
  });
});

describe("allocateEven", () => {
  it("allocates into n equal parts with exact conservation", () => {
    const m = money("USD", 100n);
    const parts = allocateEven(m, 3);
    const sum = parts.reduce((acc, p) => acc + p.minorUnits, 0n);
    expect(sum).toBe(100n);
    expect(parts).toHaveLength(3);
  });

  it("allocates evenly when divisible", () => {
    const m = money("USD", 90n);
    const parts = allocateEven(m, 3);
    expect(parts.map((p) => p.minorUnits)).toEqual([30n, 30n, 30n]);
  });

  it("throws when n <= 0", () => {
    const m = money("USD", 100n);
    expect(() => allocateEven(m, 0)).toThrow();
    expect(() => allocateEven(m, -1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Money is frozen (immutable)
// ---------------------------------------------------------------------------

describe("Money immutability", () => {
  it("money objects are frozen", () => {
    const m = money("USD", 100n);
    expect(Object.isFrozen(m)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property tests (fast-check)
// ---------------------------------------------------------------------------

const arbCurrency = fc.constantFrom("EUR", "USD", "JPY", "KWD", "GBP");
const arbMinorUnits = fc.bigInt({ min: -1_000_000n, max: 1_000_000n });

const arbMoney = fc.tuple(arbCurrency, arbMinorUnits).map(([cur, units]) =>
  expectOk(fromMinorUnits(cur, units)),
);

const arbSameCurrencyPair = arbCurrency.chain((cur) =>
  fc.tuple(
    arbMinorUnits.map((u) => expectOk(fromMinorUnits(cur, u))),
    arbMinorUnits.map((u) => expectOk(fromMinorUnits(cur, u))),
  ),
);

const arbSameCurrencyTriple = arbCurrency.chain((cur) =>
  fc.tuple(
    arbMinorUnits.map((u) => expectOk(fromMinorUnits(cur, u))),
    arbMinorUnits.map((u) => expectOk(fromMinorUnits(cur, u))),
    arbMinorUnits.map((u) => expectOk(fromMinorUnits(cur, u))),
  ),
);

describe("Property: add commutativity (REQ-M-15)", () => {
  it("add(a,b) equals add(b,a) for same-currency pairs", () => {
    fc.assert(
      fc.property(arbSameCurrencyPair, ([a, b]) => {
        const ab = add(a, b);
        const ba = add(b, a);
        if (!ab.ok || !ba.ok) return false;
        return (
          ab.value.minorUnits === ba.value.minorUnits &&
          ab.value.currency === ba.value.currency
        );
      }),
    );
  });
});

describe("Property: add associativity (REQ-M-16)", () => {
  it("add(add(a,b),c) equals add(a,add(b,c)) for same-currency triples", () => {
    fc.assert(
      fc.property(arbSameCurrencyTriple, ([a, b, c]) => {
        const lhs = add(expectOk(add(a, b)), c);
        const rhs = add(a, expectOk(add(b, c)));
        if (!lhs.ok || !rhs.ok) return false;
        return (
          lhs.value.minorUnits === rhs.value.minorUnits &&
          lhs.value.currency === rhs.value.currency
        );
      }),
    );
  });
});

describe("Property: allocate conservation (REQ-M-17)", () => {
  it("sum(allocate(m, weights)) === m.minorUnits for arbitrary weights", () => {
    const arbWeights = fc.array(fc.bigInt({ min: 1n, max: 100n }), {
      minLength: 1,
      maxLength: 10,
    });
    fc.assert(
      fc.property(arbMoney, arbWeights, (m, weights) => {
        const parts = allocate(m, weights);
        const sum = parts.reduce((acc, p) => acc + p.minorUnits, 0n);
        return sum === m.minorUnits;
      }),
    );
  });
});

describe("Property: allocateEven conservation", () => {
  it("sum(allocateEven(m, n)) === m.minorUnits for n in 1..20", () => {
    const arbN = fc.integer({ min: 1, max: 20 });
    fc.assert(
      fc.property(arbMoney, arbN, (m, n) => {
        const parts = allocateEven(m, n);
        const sum = parts.reduce((acc, p) => acc + p.minorUnits, 0n);
        return sum === m.minorUnits;
      }),
    );
  });
});

describe("Property: multiplyByRate identity", () => {
  it("multiplyByRate(m, rate(1n,1n)).minorUnits === m.minorUnits", () => {
    const identityRate = rate(1n, 1n);
    fc.assert(
      fc.property(arbMoney, (m) => {
        return multiplyByRate(m, identityRate).minorUnits === m.minorUnits;
      }),
    );
  });
});
