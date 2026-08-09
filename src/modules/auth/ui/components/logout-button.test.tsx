import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LogoutButton, type LogoutButtonState } from "./logout-button";

function makeAction(state: LogoutButtonState = {}) {
  return vi.fn(async () => state);
}

describe("LogoutButton", () => {
  it("calls the action when clicked", async () => {
    const user = userEvent.setup();
    const action = makeAction();
    render(<LogoutButton action={action} />);

    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it("announces a failed sign-out instead of pretending it worked", async () => {
    // A silently failed sign-out leaves someone believing a shared machine is
    // safe. On success the action redirects and nothing is rendered here.
    const user = userEvent.setup();
    render(
      <LogoutButton
        action={makeAction({ error: "No pudimos cerrar tu sesión." })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no pudimos cerrar tu sesión/i,
    );
  });

  it("shows nothing when the sign-out succeeds", async () => {
    const user = userEvent.setup();
    render(<LogoutButton action={makeAction()} />);

    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces a REJECTED action instead of escaping to the error boundary", async () => {
    // A dropped connection or a 500 rejects the promise; it does not resolve
    // with `err`. That is the likelier failure, and it used to blow past this
    // component entirely — replacing the page with an error screen instead of
    // telling the person their session is still open.
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<LogoutButtonState> => {
      throw new Error("Failed to fetch");
    });
    render(<LogoutButton action={action} />);

    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no pudimos cerrar tu sesión/i,
    );
  });

  it("leaks no transport detail from a rejected action", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<LogoutButtonState> => {
      throw new Error("ECONNRESET at https://xyz.supabase.co/auth/v1/logout");
    });
    render(<LogoutButton action={action} />);

    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      /ECONNRESET/,
    );
  });

  it("re-enables the button after a rejection so the person can retry", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (): Promise<LogoutButtonState> => {
      throw new Error("Failed to fetch");
    });
    render(<LogoutButton action={action} />);

    const button = screen.getByRole("button", { name: /cerrar sesión/i });
    await user.click(button);
    await screen.findByRole("alert");

    expect(
      screen.getByRole("button", { name: /cerrar sesión/i }),
    ).toBeEnabled();
  });
});
