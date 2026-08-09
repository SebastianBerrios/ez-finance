import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ForgotPasswordForm,
  type ForgotPasswordFormState,
} from "./forgot-password-form";

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
  prev: ForgotPasswordFormState,
  formData: FormData,
) => Promise<ForgotPasswordFormState>;

function makeAction(result: ForgotPasswordFormState): ActionFn {
  return vi.fn().mockResolvedValue(result);
}

describe("ForgotPasswordForm", () => {
  it("renders email field and submit button in Spanish", () => {
    render(<ForgotPasswordForm action={makeAction({})} />);
    expect(screen.getByLabelText(/correo electrónico/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enviar instrucciones/i }),
    ).toBeInTheDocument();
  });

  it("shows generic non-enumerating success message on submit", async () => {
    const action = makeAction({ submitted: true });
    render(<ForgotPasswordForm action={action} />);

    await userEvent.click(
      screen.getByRole("button", { name: /enviar instrucciones/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/si existe una cuenta/i)).toBeInTheDocument();
      // Form is replaced by the success message
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  it("success message is announced via role=status", async () => {
    const action = makeAction({ submitted: true });
    render(<ForgotPasswordForm action={action} />);

    await userEvent.click(
      screen.getByRole("button", { name: /enviar instrucciones/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  it("disables submit button while pending", async () => {
    const action = vi.fn(
      () =>
        new Promise<ForgotPasswordFormState>(() => {
          /* never resolves */
        }),
    ) as unknown as ActionFn;

    render(<ForgotPasswordForm action={action} />);
    const button = screen.getByRole("button", {
      name: /enviar instrucciones/i,
    });
    await userEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
  });

  it("has back-to-login link", () => {
    render(<ForgotPasswordForm action={makeAction({})} />);
    const link = screen.getByRole("link", { name: /volver/i });
    expect(link).toHaveAttribute("href", "/login");
  });
});
