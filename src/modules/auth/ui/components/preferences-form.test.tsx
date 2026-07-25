import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreferencesForm, type PreferencesFormState } from "./preferences-form";

describe("PreferencesForm — render and structure", () => {
  it("renders language select with correct label", () => {
    render(<PreferencesForm action={vi.fn()} />);
    expect(screen.getByLabelText(/idioma/i)).toBeInTheDocument();
  });

  it("renders currency select with correct label", () => {
    render(<PreferencesForm action={vi.fn()} />);
    expect(screen.getByLabelText(/moneda principal/i)).toBeInTheDocument();
  });

  it("renders submit button in Spanish", () => {
    render(<PreferencesForm action={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /guardar preferencias/i }),
    ).toBeInTheDocument();
  });

  it("defaults language select to 'es'", () => {
    render(<PreferencesForm action={vi.fn()} />);
    const select = screen.getByLabelText(/idioma/i) as HTMLSelectElement;
    expect(select.value).toBe("es");
  });

  it("pre-fills language from initialLanguage prop", () => {
    render(<PreferencesForm action={vi.fn()} initialLanguage="en" />);
    const select = screen.getByLabelText(/idioma/i) as HTMLSelectElement;
    expect(select.value).toBe("en");
  });

  it("pre-fills currency from initialCurrency prop", () => {
    render(<PreferencesForm action={vi.fn()} initialCurrency="USD" />);
    const select = screen.getByLabelText(/moneda principal/i) as HTMLSelectElement;
    expect(select.value).toBe("USD");
  });

  it("currency select includes ARS option", () => {
    render(<PreferencesForm action={vi.fn()} />);
    expect(screen.getByRole("option", { name: /ARS/i })).toBeInTheDocument();
  });

  it("does not show error or success initially", () => {
    render(<PreferencesForm action={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("PreferencesForm — success and error display", () => {
  it("shows success message when action returns success", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ success: true } as PreferencesFormState);

    render(<PreferencesForm action={action} />);

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /preferencias guardadas/i,
      );
    });
  });

  it("shows error message when action returns error", () => {
    const action = vi.fn().mockResolvedValue({
      error: "No pudimos guardar tus preferencias.",
    } as PreferencesFormState);

    render(<PreferencesForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /no pudimos guardar/i,
      );
    });
  });
});
