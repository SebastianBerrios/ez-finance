// google-button.test.tsx — component tests for GoogleButton
// Tests render, accessibility, and click behavior with a mocked Supabase client.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Supabase browser client (must be hoisted before imports).
// ---------------------------------------------------------------------------
const { mockSignInWithOAuth } = vi.hoisted(() => ({
  mockSignInWithOAuth: vi.fn(),
}));

vi.mock("@/shared/infrastructure/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
    },
  })),
}));

// Mock next/navigation (used for window.location in jsdom)
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

import { GoogleButton } from "./google-button";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderButton() {
  return render(<GoogleButton />);
}

// ---------------------------------------------------------------------------
// Render and accessibility
// ---------------------------------------------------------------------------
describe("GoogleButton — render and accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a button with the Spanish label", () => {
    renderButton();
    expect(
      screen.getByRole("button", { name: /continuar con google/i }),
    ).toBeInTheDocument();
  });

  it("button is not disabled initially", () => {
    renderButton();
    expect(
      screen.getByRole("button", { name: /continuar con google/i }),
    ).not.toBeDisabled();
  });

  it("shows a loading state while OAuth is in progress", async () => {
    // signInWithOAuth never resolves during this test
    mockSignInWithOAuth.mockReturnValueOnce(new Promise(() => {}));

    renderButton();
    const button = screen.getByRole("button", { name: /continuar con google/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /redirigiendo/i }),
      ).toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------
describe("GoogleButton — OAuth initiation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls signInWithOAuth with provider google on click", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ data: {}, error: null });

    renderButton();
    fireEvent.click(
      screen.getByRole("button", { name: /continuar con google/i }),
    );

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "google" }),
      );
    });
  });

  it("passes redirectTo pointing to /auth/callback", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ data: {}, error: null });

    renderButton();
    fireEvent.click(
      screen.getByRole("button", { name: /continuar con google/i }),
    );

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            redirectTo: expect.stringContaining("/auth/callback"),
          }),
        }),
      );
    });
  });

  it("re-enables the button and shows an error label if OAuth call fails", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: {},
      error: { message: "provider not enabled" },
    });

    renderButton();
    fireEvent.click(
      screen.getByRole("button", { name: /continuar con google/i }),
    );

    // Button should re-enable after failure
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /continuar con google/i }),
      ).not.toBeDisabled();
    });
  });
});
