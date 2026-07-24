"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface RegisterFormState {
  error?: string;
  success?: boolean;
}

type RegisterActionFn = (
  prev: RegisterFormState,
  formData: FormData,
) => Promise<RegisterFormState>;

interface RegisterFormProps {
  action: RegisterActionFn;
}

const initialState: RegisterFormState = {};

// Client-side password policy check for immediate feedback.
// The server action is the authoritative source of truth.
function isWeakPassword(password: string): boolean {
  if (password.length === 0) return false; // do not warn on empty
  const codePoints = [...password].length;
  const hasLetter = /\p{L}/u.test(password);
  const hasDigit = /\p{N}/u.test(password);
  return codePoints < 10 || !hasLetter || !hasDigit;
}

export function RegisterForm({ action }: RegisterFormProps) {
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
        <Label htmlFor="register-email">Correo electrónico</Label>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="register-password">Contraseña</Label>
        <Input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••••"
          disabled={isPending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="register-password-hint"
        />
        <p
          id="register-password-hint"
          className={`text-xs ${showPolicyWarning ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {showPolicyWarning
            ? "La contraseña no cumple los requisitos."
            : "Mínimo 10 caracteres, una letra y un número."}
        </p>
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Creando cuenta…" : "Crear cuenta"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        ¿Ya tenés cuenta?{" "}
        <Link
          href="/login"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Ingresá
        </Link>
      </p>
    </form>
  );
}
