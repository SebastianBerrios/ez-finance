import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProfileForm, type ProfileFormState } from "./profile-form";

describe("ProfileForm — render and structure", () => {
  it("renders display name input with correct label", () => {
    render(<ProfileForm action={vi.fn()} />);
    expect(screen.getByLabelText(/nombre para mostrar/i)).toHaveAttribute(
      "type",
      "text",
    );
  });

  it("renders submit button in Spanish", () => {
    render(<ProfileForm action={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /guardar cambios/i }),
    ).toBeInTheDocument();
  });

  it("pre-fills display name from initialDisplayName prop", () => {
    render(<ProfileForm action={vi.fn()} initialDisplayName="Ana García" />);
    expect(screen.getByLabelText(/nombre para mostrar/i)).toHaveValue(
      "Ana García",
    );
  });

  it("display name input has name autocomplete attribute", () => {
    render(<ProfileForm action={vi.fn()} />);
    expect(screen.getByLabelText(/nombre para mostrar/i)).toHaveAttribute(
      "autocomplete",
      "name",
    );
  });

  it("does not show error or success initially", () => {
    render(<ProfileForm action={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("input accepts typed text", async () => {
    render(<ProfileForm action={vi.fn()} />);
    const input = screen.getByLabelText(/nombre para mostrar/i);
    await userEvent.clear(input);
    await userEvent.type(input, "Nuevo Nombre");
    expect(input).toHaveValue("Nuevo Nombre");
  });
});

describe("ProfileForm — success and error display", () => {
  it("shows success message when action returns success", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ success: true } as ProfileFormState);

    render(<ProfileForm action={action} />);

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /perfil actualizado/i,
      );
    });
  });

  it("shows error message when action returns error", () => {
    const action = vi.fn().mockResolvedValue({
      error: "No pudimos actualizar tu perfil.",
    } as ProfileFormState);

    render(<ProfileForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /no pudimos actualizar/i,
      );
    });
  });

  it("error element has aria-live=assertive", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ error: "Error genérico" } as ProfileFormState);

    render(<ProfileForm action={action} />);

    const form = document.querySelector("form");
    if (form) fireEvent.submit(form);

    return waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveAttribute("aria-live", "assertive");
    });
  });
});
