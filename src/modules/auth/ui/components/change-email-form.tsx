"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface ChangeEmailFormState {
  success?: boolean;
  error?: string;
}

type ChangeEmailActionFn = (
  prev: ChangeEmailFormState,
  formData: FormData,
) => Promise<ChangeEmailFormState>;

interface ChangeEmailFormProps {
  action: ChangeEmailActionFn;
}

const initialState: ChangeEmailFormState = {};

// NOTE: actual verification email delivery is deferred until Resend SMTP is
// configured. The code path (updateUser({email}) + verification link) is
// correct and ready — Supabase will send the link once an SMTP relay is set.
export function ChangeEmailForm({ action }: ChangeEmailFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (state.success) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-muted rounded-lg px-4 py-4 text-sm"
      >
        Te enviamos un enlace de verificación a tu correo nuevo. Seguí las
        instrucciones para confirmar el cambio.
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
        <Label htmlFor="change-email-new">Nuevo correo electrónico</Label>
        <Input
          id="change-email-new"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="nuevo@correo.com"
          disabled={isPending}
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Enviando…" : "Cambiar correo"}
      </Button>
    </form>
  );
}
