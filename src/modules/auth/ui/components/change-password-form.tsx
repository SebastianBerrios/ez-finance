"use client";

import { useActionState, useState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface ChangePasswordFormState {
  success?: boolean;
  error?: string;
}

type ChangePasswordActionFn = (
  prev: ChangePasswordFormState,
  formData: FormData,
) => Promise<ChangePasswordFormState>;

interface ChangePasswordFormProps {
  action: ChangePasswordActionFn;
}

const initialState: ChangePasswordFormState = {};

// Client-side password policy check for immediate feedback.
// The server action is the authoritative source of truth.
function isWeakPassword(password: string): boolean {
  if (password.length === 0) return false; // do not warn on empty
  const codePoints = [...password].length;
  const hasLetter = /\p{L}/u.test(password);
  const hasDigit = /\p{N}/u.test(password);
  return codePoints < 10 || !hasLetter || !hasDigit;
}

export function ChangePasswordForm({ action }: ChangePasswordFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [password, setPassword] = useState("");

  const showPolicyWarning = isWeakPassword(password);

  if (state.success) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-muted rounded-lg px-4 py-4 text-sm"
      >
        Contraseña actualizada correctamente. Las otras sesiones activas fueron
        cerradas.
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="change-password-new">Nueva contraseña</Label>
        <Input
          id="change-password-new"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••••"
          disabled={isPending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="change-password-hint"
        />
        <p
          id="change-password-hint"
          className={`text-xs ${showPolicyWarning ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {showPolicyWarning
            ? "La contraseña no cumple los requisitos."
            : "Mínimo 10 caracteres, una letra y un número."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="change-password-confirm">Confirmá la contraseña</Label>
        <Input
          id="change-password-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••••"
          disabled={isPending}
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Actualizando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
