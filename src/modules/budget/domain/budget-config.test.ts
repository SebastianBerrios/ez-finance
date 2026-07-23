// budget-config.test.ts — TDD-RED for validateConfig
// Tests: REQ-E-02 (bad sum), REQ-E-02 (negative pct), valid config succeeds

import { describe, expect, it } from "vitest";
import type { BudgetConfig } from "@shared/domain/budget-types";
import { fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { validateConfig } from "./budget-config";

function usd(n: bigint) {
  return expectOk(fromMinorUnits("USD", n));
}

describe("validateConfig", () => {
  // -------------------------------------------------------------------------
  // Valid config
  // -------------------------------------------------------------------------

  it("returns ok for valid 50/30/20 config", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 50, want: 30, save: 20 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });

  it("returns ok for valid config with all percentages summing to 100 (different distribution)", () => {
    const config: BudgetConfig = {
      incomeMode: "mayor",
      expectedIncome: usd(200000n),
      percentages: { need: 70, want: 20, save: 10 },
    };
    expect(validateConfig(config).ok).toBe(true);
  });

  it("returns ok for valid config with 0 save (e.g. 70/30/0)", () => {
    const config: BudgetConfig = {
      incomeMode: "esperado",
      expectedIncome: usd(0n),
      percentages: { need: 70, want: 30, save: 0 },
    };
    expect(validateConfig(config).ok).toBe(true);
  });

  it("returns ok for valid config with nearLimitThresholdPct provided", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 50, want: 30, save: 20 },
      nearLimitThresholdPct: 75,
    };
    expect(validateConfig(config).ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Negative percentage → err('percentage-negative') — checked BEFORE sum
  // -------------------------------------------------------------------------

  it("returns err(percentage-negative) when need is negative", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: -10, want: 60, save: 50 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ConfigError");
      expect(result.error.reason).toBe("percentage-negative");
    }
  });

  it("returns err(percentage-negative) when want is negative", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 60, want: -10, save: 50 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("percentage-negative");
    }
  });

  it("returns err(percentage-negative) when save is negative", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 60, want: 60, save: -20 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("percentage-negative");
    }
  });

  it("checks negative BEFORE sum — negative that also makes sum wrong is percentage-negative", () => {
    // sum = -10 + 60 + 50 = 100 but need is negative
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: -10, want: 60, save: 50 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("percentage-negative");
    }
  });

  // -------------------------------------------------------------------------
  // Percentages not summing to 100 → err('percentages-not-100')
  // -------------------------------------------------------------------------

  it("returns err(percentages-not-100) when sum is 105", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 50, want: 30, save: 25 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ConfigError");
      expect(result.error.reason).toBe("percentages-not-100");
    }
  });

  it("returns err(percentages-not-100) when sum is 99", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 50, want: 29, save: 20 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("percentages-not-100");
    }
  });

  it("returns err(percentages-not-100) when all zeros (sum = 0)", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 0, want: 0, save: 0 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("percentages-not-100");
    }
  });

  // -------------------------------------------------------------------------
  // Non-integer percentages → err('percentage-not-integer')
  // Design contract: percentages are WHOLE NUMBERS summing to 100.
  // -------------------------------------------------------------------------

  it("returns err(percentage-not-integer) for fractional percentages that sum to 100", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 33.33, want: 33.33, save: 33.34 }, // sum = 100 but fractional
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ConfigError");
      expect(result.error.reason).toBe("percentage-not-integer");
    }
  });

  it("returns err(percentage-not-integer) when a single percentage is fractional", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 49.5, want: 30.5, save: 20 }, // sum = 100 but need/want fractional
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("percentage-not-integer");
    }
  });

  it("accepts integer config 34/33/33 (still passes after integer guard)", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 34, want: 33, save: 33 },
    };
    expect(validateConfig(config).ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // nearLimitThresholdPct validation (if present, must be in range 0-100)
  // -------------------------------------------------------------------------

  it("returns ok when nearLimitThresholdPct is exactly 0", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 50, want: 30, save: 20 },
      nearLimitThresholdPct: 0,
    };
    expect(validateConfig(config).ok).toBe(true);
  });

  it("returns ok when nearLimitThresholdPct is exactly 100", () => {
    const config: BudgetConfig = {
      incomeMode: "real",
      expectedIncome: usd(100000n),
      percentages: { need: 50, want: 30, save: 20 },
      nearLimitThresholdPct: 100,
    };
    expect(validateConfig(config).ok).toBe(true);
  });
});
