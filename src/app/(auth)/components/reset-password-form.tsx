"use client";

import { useActionState, useState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface ResetPasswordFormState {
  error?: string;
}

type ResetPasswordActionFn = (
  prev: ResetPasswordFormState,
  formData: FormData,
) => Promise<ResetPasswordFormState>;

interface ResetPasswordFormProps {
  action: ResetPasswordActionFn;
}

const initialState: ResetPasswordFormState = {};

// Client-side password policy check for immediate feedback.
// The server action is the authoritative source of truth.
function isWeakPassword(password: string): boolean {
  if (password.length === 0) return false;
  const codePoints = [...password].length;
  const hasLetter = /\p{L}/u.test(password);
  const hasDigit = /\p{N}/u.test(password);
  return codePoints < 10 || !hasLetter || !hasDigit;
}

export function ResetPasswordForm({ action }: ResetPasswordFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [password, setPassword] = useState("");

  const showPolicyWarning = isWeakPassword(password);

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
        <Label htmlFor="reset-password-new">Nueva contraseña</Label>
        <Input
          id="reset-password-new"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••••"
          disabled={isPending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="reset-password-hint"
        />
        <p
          id="reset-password-hint"
          className={`text-xs ${showPolicyWarning ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {showPolicyWarning
            ? "La contraseña no cumple los requisitos."
            : "Mínimo 10 caracteres, una letra y un número."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-password-confirm">Confirmá la contraseña</Label>
        <Input
          id="reset-password-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••••"
          disabled={isPending}
        />
      </div>

      {/* The recovery path runs the SAME rotation as Configuración → Seguridad,
          and it is the common one. Same warning, same wording. */}
      <p className="text-muted-foreground text-xs">
        Al establecer la contraseña vamos a cerrar tu sesión en los demás
        dispositivos y aplicaciones que usen esta misma cuenta. Esta sesión
        sigue abierta.
      </p>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Actualizando…" : "Establecer contraseña"}
      </Button>
    </form>
  );
}
