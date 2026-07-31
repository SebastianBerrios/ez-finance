"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";

export interface CancelDeletionFormState {
  error?: string;
}

type CancelDeletionActionFn = (
  prev: CancelDeletionFormState,
  formData: FormData,
) => Promise<CancelDeletionFormState>;

interface CancelDeletionFormProps {
  action: CancelDeletionActionFn;
  /**
   * Deadline already formatted by the server. Formatting stays out of the
   * client so the rendered date cannot differ between server and browser
   * locales.
   */
  deadlineLabel: string;
}

const initialState: CancelDeletionFormState = {};

export function CancelDeletionForm({
  action,
  deadlineLabel,
}: CancelDeletionFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div
        role="alert"
        aria-live="polite"
        className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
      >
        <p className="font-medium">
          Tu cuenta está programada para eliminarse.
        </p>
        <p className="mt-1">
          Vamos a borrar tus datos el <strong>{deadlineLabel}</strong>. Puedes
          cancelar hasta esa fecha.
        </p>
      </div>

      {state.error && (
        <p aria-live="assertive" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Cancelando…" : "Cancelar la eliminación"}
      </Button>
    </form>
  );
}
