"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface ForgotPasswordFormState {
  submitted?: boolean;
  error?: string;
}

type RecoveryActionFn = (
  prev: ForgotPasswordFormState,
  formData: FormData,
) => Promise<ForgotPasswordFormState>;

interface ForgotPasswordFormProps {
  action: RecoveryActionFn;
}

const initialState: ForgotPasswordFormState = {};

// NON-ENUMERATING: success message is always the same regardless of whether
// the email exists or belongs to a Google account.
const GENERIC_SUCCESS_MESSAGE =
  "Si existe una cuenta con ese correo, te enviamos las instrucciones para recuperarla.";

export function ForgotPasswordForm({ action }: ForgotPasswordFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (state.submitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-muted rounded-lg px-4 py-4 text-center text-sm"
      >
        {GENERIC_SUCCESS_MESSAGE}
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
        <Label htmlFor="recovery-email">Correo electrónico</Label>
        <Input
          id="recovery-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
          disabled={isPending}
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Enviando…" : "Enviar instrucciones"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        <Link
          href="/login"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Volver al inicio de sesión
        </Link>
      </p>
    </form>
  );
}
