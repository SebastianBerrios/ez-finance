import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChangeEmailForm, type ChangeEmailFormState } from "./change-email-form";

describe("ChangeEmailForm — render and structure", () => {
  it("renders email input with correct label", () => {
    render(<ChangeEmailForm action={vi.fn()} />);
    expect(screen.getByLabelText(/nuevo correo electrónico/i)).toHaveAttribute(
      "type",
      "email",
    );
  });

  it("renders submit button in Spanish", () => {
    render(<ChangeEmailForm action={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /cambiar correo/i }),
    ).toBeInTheDocument();
  });

  it("email input has email autocomplete attribute", () => {
    render(<ChangeEmailForm action={vi.fn()} />);
    expect(screen.getByLabelText(/nuevo correo electrónico/i)).toHaveAttribute(
      "autocomplete",
      "email",
    );
  });

  it("does not show error or success initially", () => {
    render(<ChangeEmailForm action={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("email input accepts typed value", async () => {
    render(<ChangeEmailForm action={vi.fn()} />);
    const input = screen.getByLabelText(/nuevo correo electrónico/i);
    await userEvent.type(input, "nuevo@correo.com");
    expect(input).toHaveValue("nuevo@correo.com");
  });
});

describe("ChangeEmailForm — success and error display", () => {
  it("shows verification message on success", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ success: true } as ChangeEmailFormState);

    render(<ChangeEmailForm action={action} />);

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /enlace de verificación/i,
      );
    });
  });

  it("hides form and shows success status on success", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ success: true } as ChangeEmailFormState);

    render(<ChangeEmailForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  it("shows generic error message — never reveals if email is taken", () => {
    const action = vi.fn().mockResolvedValue({
      error: "No pudimos actualizar tu correo. Verificá el formato e intentá de nuevo.",
    } as ChangeEmailFormState);

    render(<ChangeEmailForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      // Must NOT contain enumeration-leaking phrases
      expect(alert.textContent).not.toMatch(/ya registrado/i);
      expect(alert.textContent).not.toMatch(/ya existe/i);
      expect(alert.textContent).not.toMatch(/email.* en uso/i);
    });
  });
});
