"use client";

// google-button.tsx — client component that initiates Google OAuth.
//
// Design choice: calls supabase.auth.signInWithOAuth() directly from the browser
// (NOT via a server action). Rationale:
//   1. REQ-OAUTH-01 explicitly requires a client-side call.
//   2. OAuth requires the browser to perform the redirect; a server action would
//      need to return a URL and then do a client-side redirect anyway — adding
//      a round-trip with no benefit.
//   3. The browser Supabase client handles the full PKCE flow and redirects
//      automatically when skipBrowserRedirect is omitted (default = false).
//
// NOTE: Full end-to-end authentication requires the Google provider to be
// configured in the Supabase project (dashboard > Auth > Providers > Google).
// Until then, clicking this button will return an error from Supabase.
import { useState } from "react";

import { createClient } from "@/shared/infrastructure/supabase/client";
import { Button } from "@shared/ui/button";

export function GoogleButton() {
  const [isPending, setIsPending] = useState(false);

  async function handleGoogleLogin() {
    setIsPending(true);

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Supabase will redirect the browser to Google, then back to /auth/callback.
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      // OAuth initiation failed (e.g. provider not configured yet).
      // Re-enable the button so the user can retry.
      setIsPending(false);
    }
    // On success, signInWithOAuth redirects the browser — no further state update needed.
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={isPending}
      onClick={handleGoogleLogin}
    >
      {isPending ? (
        "Redirigiendo…"
      ) : (
        <>
          {/* Google G icon (inline SVG — no external dependency) */}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continuar con Google
        </>
      )}
    </Button>
  );
}
