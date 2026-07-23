import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fromMinorUnits } from "@shared/domain/money";

import { MoneyDisplay } from "./money-display";

afterEach(() => {
  cleanup();
});

// Helper: build a Money value directly (expectOk pattern)
function money(currency: string, minorUnits: bigint) {
  const result = fromMinorUnits(currency, minorUnits);
  if (!result.ok) throw new Error(`Invalid currency: ${currency}`);
  return result.value;
}

describe("MoneyDisplay", () => {
  it("Scenario D-1: renders positive Money — 123456n EUR (~1234.56 EUR)", () => {
    render(<MoneyDisplay amount={money("EUR", 123456n)} />);
    const element = screen.getByRole("status");
    // jsdom may not have full ICU data for Spanish locale thousands separator
    // but should at least show the decimal and EUR symbol
    expect(element.textContent).toMatch(/1\s*[,.]?\s*234/);
    expect(element.textContent).toMatch(/56/);
    expect(element.textContent).toMatch(/€/);
  });

  it("Scenario D-2: renders zero Money — 0n EUR", () => {
    render(<MoneyDisplay amount={money("EUR", 0n)} />);
    const element = screen.getByRole("status");
    expect(element.textContent).toMatch(/€/);
    // Zero should not throw or render blank
    expect(element.textContent).toBeTruthy();
  });

  it("Scenario D-2: renders negative Money — -500n EUR (~-5.00 EUR)", () => {
    render(<MoneyDisplay amount={money("EUR", -500n)} />);
    const element = screen.getByRole("status");
    expect(element.textContent).toMatch(/€/);
    expect(element.textContent).toMatch(/-/);
  });

  it("renders USD amounts correctly (1050n = $10.50)", () => {
    render(<MoneyDisplay amount={money("USD", 1050n)} />);
    const element = screen.getByRole("status");
    expect(element.textContent).toMatch(/\$/);
    expect(element.textContent).toMatch(/10/);
  });

  it("applies text-income class when variant is income", () => {
    render(<MoneyDisplay amount={money("EUR", 100n)} variant="income" />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("text-income");
  });

  it("applies text-expense class when variant is expense", () => {
    render(<MoneyDisplay amount={money("EUR", 100n)} variant="expense" />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("text-expense");
  });

  it("applies text-transfer class when variant is transfer", () => {
    render(<MoneyDisplay amount={money("EUR", 100n)} variant="transfer" />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("text-transfer");
  });

  it("applies no variant class when variant is neutral", () => {
    render(<MoneyDisplay amount={money("EUR", 100n)} variant="neutral" />);
    const element = screen.getByRole("status");
    expect(element).not.toHaveClass("text-income");
    expect(element).not.toHaveClass("text-expense");
    expect(element).not.toHaveClass("text-transfer");
  });

  it("renders with font-mono and tabular-nums classes", () => {
    render(<MoneyDisplay amount={money("EUR", 100n)} />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("font-mono");
    expect(element).toHaveClass("tabular-nums");
  });
});
