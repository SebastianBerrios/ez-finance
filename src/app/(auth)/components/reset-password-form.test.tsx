import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ResetPasswordForm,
  type ResetPasswordFormState,
} from "./reset-password-form";

describe("ResetPasswordForm — render and structure", () => {
  it("renders new password input with correct label", () => {
    render(<ResetPasswordForm action={vi.fn()} />);
    expect(screen.getByLabelText(/nueva contraseña/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("renders confirm password input", () => {
    render(<ResetPasswordForm action={vi.fn()} />);
    expect(screen.getByLabelText(/confirma la contraseña/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("renders submit button in Spanish", () => {
    render(<ResetPasswordForm action={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /establecer contraseña/i }),
    ).toBeInTheDocument();
  });

  it("shows password policy hint", () => {
    render(<ResetPasswordForm action={vi.fn()} />);
    expect(screen.getByText(/mínimo 10 caracteres/i)).toBeInTheDocument();
  });

  it("does not show error initially", () => {
    render(<ResetPasswordForm action={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ResetPasswordForm — client-side policy feedback", () => {
  it("shows policy warning when password is too short", async () => {
    render(<ResetPasswordForm action={vi.fn()} />);
    const passwordInput = screen.getByLabelText(/nueva contraseña/i);
    await userEvent.type(passwordInput, "abc1");
    await waitFor(() => {
      expect(screen.getByText(/no cumple los requisitos/i)).toBeInTheDocument();
    });
  });
});

describe("ResetPasswordForm — error display", () => {
  it("shows error message when action returns error", () => {
    const action = vi.fn().mockResolvedValue({
      error: "El enlace de recuperación expiró.",
    } as ResetPasswordFormState);

    render(<ResetPasswordForm action={action} />);

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /enlace de recuperación/i,
      );
    });
  });

  it("error element has aria-live=assertive", () => {
    const action = vi.fn().mockResolvedValue({
      error: "Error genérico",
    } as ResetPasswordFormState);

    render(<ResetPasswordForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveAttribute("aria-live", "assertive");
    });
  });
  it("warns that other devices will be signed out, BEFORE the submit", () => {
    // The recovery path runs the same rotation as Configuración → Seguridad,
    // and it is the common one.
    render(<ResetPasswordForm action={vi.fn()} />);

    expect(
      screen.getByText(/cerrar tu sesión en los demás dispositivos/i),
    ).toBeInTheDocument();
  });
});
