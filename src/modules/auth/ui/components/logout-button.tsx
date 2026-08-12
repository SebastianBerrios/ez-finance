"use client";

import { useState, useTransition } from "react";

import { Button } from "@shared/ui/button";
import { purgeOfflineCaches } from "@shared/ui/purge-offline-caches";

export interface LogoutButtonState {
  error?: string;
}

interface LogoutButtonProps {
  action: () => Promise<LogoutButtonState>;
}

// Never quotes the underlying failure: a transport error string is noise to the
// person reading it and can carry the project URL.
const FAILED =
  "No pudimos cerrar tu sesión. Intentá de nuevo en unos minutos y, si seguís con problemas, cerrá el navegador.";

export function LogoutButton({ action }: LogoutButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  function handleLogout() {
    startTransition(async () => {
      // BEFORE the sign-out, and awaited: the offline caches hold rendered dashboards
      // with real amounts, and on a shared computer they would outlive the session.
      // Awaiting it means the purge finishes before the redirect navigates away.
      // It never throws — a cache that will not open must not block the logout.
      await purgeOfflineCaches();

      // Two different failures, one message. The action RESOLVES with an error
      // when the sign-out itself failed, and REJECTS when the request never
      // completed (dropped connection, 500) — the likelier of the two. An
      // unhandled rejection escapes to the nearest error boundary and replaces
      // the page, so the person never learns their session is still open on a
      // machine they believe they just left.
      try {
        const state = await action();
        setError(state?.error);
      } catch {
        setError(FAILED);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={handleLogout}
      >
        {isPending ? "Cerrando sesión…" : "Cerrar sesión"}
      </Button>
    </div>
  );
}
