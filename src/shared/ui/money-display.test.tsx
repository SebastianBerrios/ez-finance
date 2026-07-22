import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MoneyDisplay } from "./money-display";

afterEach(() => {
  cleanup();
});

describe("MoneyDisplay", () => {
  it("renders 1234.56 EUR formatted as currency", () => {
    render(<MoneyDisplay amount={1234.56} currency="EUR" />);
    const element = screen.getByRole("status");
    // jsdom may not have full ICU data for Spanish locale thousands separator
    // but should at least show the decimal and EUR symbol
    expect(element.textContent).toMatch(/1\s*[,.]?\s*234/);
    expect(element.textContent).toMatch(/56/);
    expect(element.textContent).toMatch(/€/);
  });

  it("applies text-income class when variant is income", () => {
    render(<MoneyDisplay amount={100} currency="EUR" variant="income" />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("text-income");
  });

  it("applies text-expense class when variant is expense", () => {
    render(<MoneyDisplay amount={100} currency="EUR" variant="expense" />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("text-expense");
  });

  it("applies text-transfer class when variant is transfer", () => {
    render(<MoneyDisplay amount={100} currency="EUR" variant="transfer" />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("text-transfer");
  });

  it("applies no variant class when variant is neutral", () => {
    render(<MoneyDisplay amount={100} currency="EUR" variant="neutral" />);
    const element = screen.getByRole("status");
    expect(element).not.toHaveClass("text-income");
    expect(element).not.toHaveClass("text-expense");
    expect(element).not.toHaveClass("text-transfer");
  });

  it("renders with font-mono and tabular-nums classes", () => {
    render(<MoneyDisplay amount={100} currency="EUR" />);
    const element = screen.getByRole("status");
    expect(element).toHaveClass("font-mono");
    expect(element).toHaveClass("tabular-nums");
  });
});
