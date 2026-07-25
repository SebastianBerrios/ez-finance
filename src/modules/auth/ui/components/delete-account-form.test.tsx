import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DeleteAccountForm,
  type DeleteAccountFormState,
} from "./delete-account-form";

function makeAction(state: DeleteAccountFormState = {}) {
  return vi.fn(
    async (_prev: DeleteAccountFormState, _formData: FormData) => state,
  );
}

describe("DeleteAccountForm", () => {
  it("keeps the destructive submit disabled until the confirmation word is typed", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountForm action={makeAction()} />);

    const submit = screen.getByRole("button", { name: /eliminar mi cuenta/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/escribí/i), "ELIMINAR");

    expect(submit).toBeEnabled();
  });

  it("stays disabled when the confirmation word is only partially typed", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountForm action={makeAction()} />);

    await user.type(screen.getByLabelText(/escribí/i), "ELIMIN");

    expect(
      screen.getByRole("button", { name: /eliminar mi cuenta/i }),
    ).toBeDisabled();
  });

  it("accepts the confirmation word regardless of surrounding whitespace or case", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountForm action={makeAction()} />);

    await user.type(screen.getByLabelText(/escribí/i), " eliminar ");

    expect(
      screen.getByRole("button", { name: /eliminar mi cuenta/i }),
    ).toBeEnabled();
  });

  it("announces the 30-day grace period so the user knows it is reversible", () => {
    render(<DeleteAccountForm action={makeAction()} />);

    expect(screen.getByText(/30 días/i)).toBeInTheDocument();
  });

  it("submits the confirmation to the action", async () => {
    const user = userEvent.setup();
    const action = makeAction();
    render(<DeleteAccountForm action={action} />);

    await user.type(screen.getByLabelText(/escribí/i), "ELIMINAR");
    await user.click(screen.getByRole("button", { name: /eliminar mi cuenta/i }));

    expect(action).toHaveBeenCalledTimes(1);
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("confirm")).toBe("ELIMINAR");
  });

  it("shows no alert before the first submit", () => {
    render(
      <DeleteAccountForm action={makeAction({ error: "No pudimos procesarlo." })} />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error returned by the action after a failed submit", async () => {
    const user = userEvent.setup();
    const action = makeAction({ error: "No pudimos procesar la solicitud." });
    render(<DeleteAccountForm action={action} />);

    await user.type(screen.getByLabelText(/escribí/i), "ELIMINAR");
    await user.click(screen.getByRole("button", { name: /eliminar mi cuenta/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no pudimos procesar la solicitud/i,
    );
  });
});
