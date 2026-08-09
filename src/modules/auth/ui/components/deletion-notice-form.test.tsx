import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DeletionNoticeForm,
  type DeletionNoticeFormState,
} from "./deletion-notice-form";

function makeAction(state: DeletionNoticeFormState = {}) {
  return vi.fn(
    async (_prev: DeletionNoticeFormState, _formData: FormData) => state,
  );
}

describe("DeletionNoticeForm", () => {
  it("tells the person their data is gone", () => {
    render(<DeletionNoticeForm action={makeAction()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /eliminamos tus datos/i,
    );
  });

  it("does nothing until the person confirms", () => {
    // The whole reason this is a form: acknowledging and signing out are
    // one-shot destructive effects and must not fire on a bare page load.
    const action = makeAction();
    render(<DeletionNoticeForm action={action} />);

    expect(action).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /cerrar sesión/i }),
    ).toBeInTheDocument();
  });

  it("shows the erasure date when the server could format one", () => {
    render(
      <DeletionNoticeForm
        action={makeAction()}
        erasedOnLabel="25 de julio de 2026"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/25 de julio de 2026/);
  });

  it("still reads correctly with no erasure date", () => {
    render(<DeletionNoticeForm action={makeAction()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/plazo de 30 días/i);
  });

  it("runs the action when the person confirms", async () => {
    const user = userEvent.setup();
    const action = makeAction();
    render(<DeletionNoticeForm action={action} />);

    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it("shows the error returned by a failed sign-out", async () => {
    const user = userEvent.setup();
    render(
      <DeletionNoticeForm
        action={makeAction({ error: "No pudimos cerrar tu sesión." })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(
      await screen.findByText(/no pudimos cerrar tu sesión/i),
    ).toBeInTheDocument();
  });
});
