import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginForm, type LoginFormState } from "./login-form";

// Stub next/link — jsdom has no router
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("LoginForm — render and structure", () => {
  it("renders email input with correct label", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAttribute("type", "email");
  });

  it("renders password input with correct label", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute("type", "password");
  });

  it("renders submit button in Spanish", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByRole("button", { name: /ingresar/i })).toBeInTheDocument();
  });

  it("email input has correct autocomplete attribute", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAttribute(
      "autocomplete",
      "email",
    );
  });

  it("password input has current-password autocomplete", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("has forgot-password link pointing to /forgot-password", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByRole("link", { name: /olvidaste/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("has register link", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByRole("link", { name: /registrate/i })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("does not show error alert initially", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("fields accept typed input", async () => {
    render(<LoginForm action={vi.fn()} />);
    const emailInput = screen.getByLabelText(/correo electrónico/i);
    await userEvent.type(emailInput, "test@example.com");
    expect(emailInput).toHaveValue("test@example.com");
  });
});

describe("LoginForm — generic error display", () => {
  it("shows generic error when action state has error", () => {
    const GENERIC_ERROR = "Correo o contraseña incorrectos.";

    const action = vi
      .fn()
      .mockResolvedValue({ error: GENERIC_ERROR } as LoginFormState);

    render(<LoginForm action={action} />);

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    // After action resolves, the error should appear
    return waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(GENERIC_ERROR);
    });
  });

  it("error element has aria-live=assertive for screen readers", () => {
    // When an error is present from initial state: test structure directly
    // by checking the alert role element is present in the render.
    // We can pre-simulate the error state by testing the component's error rendering logic.
    // Use a custom wrapper that seeds the state.
    const TestWrapper = () => {
      // Simulate the form being shown with a pre-existing error
      // by passing a state-injecting action
      const action = vi
        .fn()
        .mockResolvedValue({ error: "Test error" } as LoginFormState);

      return <LoginForm action={action} />;
    };

    render(<TestWrapper />);
    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveAttribute("aria-live", "assertive");
    });
  });
});
