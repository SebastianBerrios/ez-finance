import { describe, expect, it } from "vitest";

import { parseAmountToMinorUnits } from "./money-input";

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
