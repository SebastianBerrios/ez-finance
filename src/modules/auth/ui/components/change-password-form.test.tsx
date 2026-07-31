import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ChangePasswordForm,
  type ChangePasswordFormState,
} from "./change-password-form";

describe("ChangePasswordForm — render and structure", () => {
  it("renders new password input with correct label", () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    expect(screen.getByLabelText(/nueva contraseña/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("renders confirm password input with correct label", () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    expect(screen.getByLabelText(/confirma la contraseña/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("renders submit button in Spanish", () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /cambiar contraseña/i }),
    ).toBeInTheDocument();
  });

  it("new password input has new-password autocomplete", () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    const inputs = screen
      .getAllByLabelText(/contraseña/i)
      .filter((el) => el.getAttribute("autocomplete") === "new-password");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it("does not show error or success initially", () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows policy hint for minimum length", () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    expect(screen.getByText(/mínimo 10 caracteres/i)).toBeInTheDocument();
  });
});

describe("ChangePasswordForm — client-side policy feedback", () => {
  it("shows policy warning when password is too short", async () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    const passwordInput = screen.getByLabelText(/nueva contraseña/i);
    await userEvent.type(passwordInput, "abc1");
    await waitFor(() => {
      expect(screen.getByText(/no cumple los requisitos/i)).toBeInTheDocument();
    });
  });

  it("does not show policy warning when password meets requirements", async () => {
    render(<ChangePasswordForm action={vi.fn()} />);
    const passwordInput = screen.getByLabelText(/nueva contraseña/i);
    await userEvent.type(passwordInput, "password123abc");
    await waitFor(() => {
      expect(
        screen.queryByText(/no cumple los requisitos/i),
      ).not.toBeInTheDocument();
    });
  });
});

describe("ChangePasswordForm — success and error display", () => {
  it("shows success message when action returns success", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ success: true } as ChangePasswordFormState);

    render(<ChangePasswordForm action={action} />);

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /contraseña actualizada/i,
      );
    });
  });

  it("shows error message when action returns error", () => {
    const action = vi.fn().mockResolvedValue({
      error: "No pudimos actualizar tu contraseña.",
    } as ChangePasswordFormState);

    render(<ChangePasswordForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /no pudimos actualizar/i,
      );
    });
  });

  it("hides form and shows success status on success", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ success: true } as ChangePasswordFormState);

    render(<ChangePasswordForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      // Form should be replaced by success message
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });
  it("warns that other devices will be signed out, BEFORE the submit", () => {
    // Rotating the password is the one place in the app that revokes sessions
    // beyond this browser, and mvp-lab shares auth.users with the rest of the
    // fleet — so it reaches the other apps too.
    render(<ChangePasswordForm action={vi.fn()} />);

    expect(
      screen.getByText(/cerrar tu sesión en los demás dispositivos/i),
    ).toBeInTheDocument();
  });
});
