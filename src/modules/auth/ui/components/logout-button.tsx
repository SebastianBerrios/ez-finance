"use client";

import { useTransition } from "react";

import { Button } from "@shared/ui/button";

interface LogoutButtonProps {
  action: () => Promise<void>;
}

export function LogoutButton({ action }: LogoutButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      await action();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isPending}
      onClick={handleLogout}
    >
      {isPending ? "Cerrando sesión…" : "Cerrar sesión"}
    </Button>
  );
}
