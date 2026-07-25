"use client";

import { useState, useTransition } from "react";

import { Button } from "@shared/ui/button";

export interface LogoutButtonState {
  error?: string;
}

interface LogoutButtonProps {
  action: () => Promise<LogoutButtonState>;
}

export function LogoutButton({ action }: LogoutButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  function handleLogout() {
    startTransition(async () => {
      // On success the action redirects and this resolves with nothing. On
      // failure it resolves with a message — which must be SHOWN: a silent
      // failed sign-out leaves the user believing a shared machine is safe.
      const state = await action();
      setError(state?.error);
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
