import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CancelDeletionForm,
  type CancelDeletionFormState,
} from "./cancel-deletion-form";

function makeAction(state: CancelDeletionFormState = {}) {
  return vi.fn(
    async (_prev: CancelDeletionFormState, _formData: FormData) => state,
  );
}

describe("CancelDeletionForm", () => {
  it("shows the deletion deadline it was given", () => {
    render(
      <CancelDeletionForm
        action={makeAction()}
        deadlineLabel="24 de agosto de 2026"
      />,
    );

    expect(screen.getByText(/24 de agosto de 2026/)).toBeInTheDocument();
  });

  it("announces the pending deletion as an alert", () => {
    render(
      <CancelDeletionForm
        action={makeAction()}
        deadlineLabel="24 de agosto de 2026"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/elimina/i);
  });

  it("calls the action when the user cancels the deletion", async () => {
    const user = userEvent.setup();
    const action = makeAction();
    render(
      <CancelDeletionForm
        action={action}
        deadlineLabel="24 de agosto de 2026"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /cancelar la eliminación/i }),
    );

    expect(action).toHaveBeenCalledTimes(1);
  });

  it("shows the error returned by the action after a failed cancel", async () => {
    const user = userEvent.setup();
    render(
      <CancelDeletionForm
        action={makeAction({ error: "El plazo ya venció." })}
        deadlineLabel="24 de agosto de 2026"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /cancelar la eliminación/i }),
    );

    expect(await screen.findByText(/el plazo ya venció/i)).toBeInTheDocument();
  });
});
