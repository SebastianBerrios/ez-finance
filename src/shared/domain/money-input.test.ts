import { describe, expect, it } from "vitest";

import {
  formatMinorUnitsForInput,
  parseAmountToMinorUnits,
} from "./money-input";

/** PEN and every currency the app offers has 2 decimals. */
const EXP = 2;

describe("parseAmountToMinorUnits", () => {
  it("parses a whole amount", () => {
    const result = parseAmountToMinorUnits("1500", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(150000n);
  });

  it("parses two decimals", () => {
    const result = parseAmountToMinorUnits("1500.50", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(150050n);
  });

  it("pads a single decimal", () => {
    const result = parseAmountToMinorUnits("1500.5", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(150050n);
  });

  it("accepts a comma as the decimal separator", () => {
    // Spanish writes 1500,50. Refusing it would be refusing the local convention.
    const result = parseAmountToMinorUnits("1500,50", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(150050n);
  });

  it("is EXACT where a float would not be", () => {
    // parseFloat("0.1") * 100 === 10.000000000000002. This domain promises exact
    // money, so the parse is string surgery, never arithmetic.
    const result = parseAmountToMinorUnits("0.1", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(10n);
  });

  it.each([
    ["0.07", 7n],
    ["0.29", 29n],
    ["1.005", null],
    ["8.11", 811n],
  ])("parses %s exactly", (input, expected) => {
    const result = parseAmountToMinorUnits(input, EXP);
    if (expected === null) {
      expect(result.ok).toBe(false);
    } else {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    }
  });

  it("parses a negative amount", () => {
    // A credit card's opening balance is legitimately negative.
    const result = parseAmountToMinorUnits("-250.75", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(-25075n);
  });

  it("parses zero", () => {
    const result = parseAmountToMinorUnits("0", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0n);
  });

  it("parses -0 as zero, not as negative zero", () => {
    const result = parseAmountToMinorUnits("-0.00", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0n);
  });

  it("ignores surrounding and inner spaces", () => {
    const result = parseAmountToMinorUnits("  1 500,50 ", EXP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(150050n);
  });

  it("REJECTS more decimals than the currency has", () => {
    // Rounding here would silently move money. The person is told instead.
    const result = parseAmountToMinorUnits("10.555", EXP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("TooManyDecimals");
  });

  it.each([
    "",
    "   ",
    "abc",
    "1.2.3",
    "1,2,3",
    "--5",
    "5-",
    "1e3",
    "$100",
    ".",
  ])("rejects %j as malformed", (input) => {
    const result = parseAmountToMinorUnits(input, EXP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotANumber");
  });

  it("handles a zero-exponent currency", () => {
    // JPY has no minor unit, so a decimal part is meaningless.
    const yen = parseAmountToMinorUnits("1500", 0);
    expect(yen.ok).toBe(true);
    if (yen.ok) expect(yen.value).toBe(1500n);

    expect(parseAmountToMinorUnits("1500.5", 0).ok).toBe(false);
  });

  it("keeps precision far beyond a float's 2^53", () => {
    const huge = parseAmountToMinorUnits("99999999999999999.99", EXP);
    expect(huge.ok).toBe(true);
    if (huge.ok) expect(huge.value).toBe(9999999999999999999n);
  });
});

describe("formatMinorUnitsForInput", () => {
  it("writes the decimals the currency has", () => {
    expect(formatMinorUnitsForInput(150000n, EXP)).toBe("1500.00");
    expect(formatMinorUnitsForInput(2550n, EXP)).toBe("25.50");
  });

  it("pads an amount smaller than one unit", () => {
    // 5n at exponent 2 is five CENTS. Written as "5" it would parse back as five
    // soles — a hundredfold error in a field a person is about to save.
    expect(formatMinorUnitsForInput(5n, EXP)).toBe("0.05");
    expect(formatMinorUnitsForInput(50n, EXP)).toBe("0.50");
    expect(formatMinorUnitsForInput(0n, EXP)).toBe("0.00");
  });

  it("omits the separator for a zero-exponent currency", () => {
    expect(formatMinorUnitsForInput(1500n, 0)).toBe("1500");
  });

  it("keeps a negative sign in front of the padding", () => {
    // Nothing records a negative movement — the kind carries the sign — but a
    // formatter that answered "-0.05" as "0.-05" would be broken, and a helper
    // this small should not have a shape it cannot handle.
    expect(formatMinorUnitsForInput(-5n, EXP)).toBe("-0.05");
    expect(formatMinorUnitsForInput(-150000n, EXP)).toBe("-1500.00");
  });

  it("round-trips whatever parseAmountToMinorUnits accepted", () => {
    // THE PROPERTY THAT MATTERS: an edit form is prefilled with this and submits it
    // straight back. If the pair disagreed, opening a movement and pressing save
    // without touching anything would CHANGE the amount.
    for (const typed of ["0.05", "25.50", "1500.00", "99999999999999999.99"]) {
      const parsed = parseAmountToMinorUnits(typed, EXP);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(formatMinorUnitsForInput(parsed.value, EXP)).toBe(typed);
      }
    }
  });
});
