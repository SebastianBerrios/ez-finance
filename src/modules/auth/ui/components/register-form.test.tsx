import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RegisterForm, type RegisterFormState } from "./register-form";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

type ActionFn = (
  prev: RegisterFormState,
  formData: FormData,
) => Promise<RegisterFormState>;

function makeAction(result: RegisterFormState): ActionFn {
  return vi.fn().mockResolvedValue(result);
}

describe("RegisterForm", () => {
  it("renders email and password fields in Spanish", () => {
    render(<RegisterForm action={makeAction({})} />);
    expect(screen.getByLabelText(/correo electrónico/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /crear cuenta/i }),
    ).toBeInTheDocument();
  });

  it("shows server error message on failure", async () => {
    const action = makeAction({
      error: "No pudimos completar el registro. Intenta de nuevo más tarde.",
    });
    render(<RegisterForm action={action} />);

    await userEvent.click(
      screen.getByRole("button", { name: /crear cuenta/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/no pudimos completar/i)).toBeInTheDocument();
    });
  });

  it("shows weak-password error from server", async () => {
    const action = makeAction({
      error:
        "La contraseña no cumple los requisitos (mínimo 10 caracteres, letra y número).",
    });
    render(<RegisterForm action={action} />);

    await userEvent.click(
      screen.getByRole("button", { name: /crear cuenta/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /contraseña no cumple/i,
      );
    });
  });

  it("shows client-side password policy hint when password is weak", async () => {
    render(<RegisterForm action={makeAction({})} />);

    const passwordInput = screen.getByLabelText(/contraseña/i);
    await userEvent.type(passwordInput, "abc");

    await waitFor(() => {
      expect(
        screen.getByText("La contraseña no cumple los requisitos."),
      ).toBeInTheDocument();
    });
  });

  it("shows policy hint (not warning) on empty password", () => {
    render(<RegisterForm action={makeAction({})} />);
    expect(screen.getByText(/mínimo 10 caracteres/i)).toBeInTheDocument();
  });

  it("clears policy warning once password meets requirements", async () => {
    render(<RegisterForm action={makeAction({})} />);
    const passwordInput = screen.getByLabelText(/contraseña/i);

    await userEvent.type(passwordInput, "Validpass1");

    await waitFor(() => {
      expect(
        screen.queryByText("La contraseña no cumple los requisitos."),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/mínimo 10 caracteres/i)).toBeInTheDocument();
    });
  });

  it("disables submit button while pending", async () => {
    const action = vi.fn(
      () =>
        new Promise<RegisterFormState>(() => {
          /* never resolves */
        }),
    ) as unknown as ActionFn;

    render(<RegisterForm action={action} />);
    const button = screen.getByRole("button", { name: /crear cuenta/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
  });
});
