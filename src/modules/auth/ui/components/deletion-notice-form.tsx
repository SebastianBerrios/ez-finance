"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";

export interface DeletionNoticeFormState {
  error?: string;
}

type DeletionNoticeActionFn = (
  prev: DeletionNoticeFormState,
  formData: FormData,
) => Promise<DeletionNoticeFormState>;

interface DeletionNoticeFormProps {
  action: DeletionNoticeActionFn;
  /**
   * Erasure date, already formatted by the server so it cannot render
   * differently in the browser locale. Absent when the timestamp was
   * unreadable — the notice is still true without it.
   */
  erasedOnLabel?: string;
}

const initialState: DeletionNoticeFormState = {};

/**
 * The terminal notice. It is a FORM, not a redirect: acknowledging the erasure
 * and closing the session are destructive, one-shot side effects, and they must
 * happen because the person confirmed it — not because something loaded a URL
 * on their behalf.
 */
export function DeletionNoticeForm({
  action,
  erasedOnLabel,
}: DeletionNoticeFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div role="alert" className="bg-muted rounded-lg px-4 py-3 text-sm">
        <p className="font-medium">Eliminamos tus datos de ez finance.</p>
        <p className="mt-1">
          {erasedOnLabel
            ? `Venció el plazo de 30 días y el ${erasedOnLabel} borramos tu perfil y tus espacios personales.`
            : "Venció el plazo de 30 días y borramos tu perfil y tus espacios personales."}{" "}
          Tu cuenta de acceso sigue disponible para otras aplicaciones, y si
          ingresás de nuevo vas a empezar desde cero.
        </p>
      </div>

      {state.error && (
        <p
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Cerrando sesión…" : "Entendido, cerrar sesión"}
      </Button>
    </form>
  );
}
