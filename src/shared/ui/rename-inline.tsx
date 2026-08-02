"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";

export interface RenameState {
  error?: string;
  renamed?: string;
}

type RenameActionFn = (
  prev: RenameState,
  formData: FormData,
) => Promise<RenameState>;

interface RenameInlineProps {
  action: RenameActionFn;
  /** Form field carrying the row's id — `categoryId` or `accountId`. */
  idField: string;
  id: string;
  currentName: string;
  maxLength: number;
  /** For the accessible label, e.g. "categoría" or "cuenta". */
  thing: string;
}

const initialState: RenameState = {};

/**
 * Rename one row, in place.
 *
 * SHARED between the categories and accounts lists rather than written twice, because
 * the only real differences are the name of the id field and the length limit — and two
 * copies of an edit-in-place widget is how one of them ends up handling the error state
 * and the other not.
 *
 * COLLAPSED UNTIL ASKED FOR. An always-visible text input next to every row turns a
 * list you read into a form you might edit by accident; renaming is rare enough that
 * one click to reveal it is the right trade.
 */
export function RenameInline({
  action,
  idField,
  id,
  currentName,
  maxLength,
  thing,
}: RenameInlineProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [open, setOpen] = useState(false);

  // CLOSE ON SUCCESS. The action revalidates the route, so the row re-renders with the
  // new name — but this component is not remounted, so `open` would survive and leave
  // an edit box sitting over a row that is already correct. It reads as "the rename did
  // not take", which is the opposite of what happened.
  useEffect(() => {
    if (state.renamed !== undefined) setOpen(false);
  }, [state.renamed]);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Renombrar ${thing} ${currentName}`}
      >
        Renombrar
      </Button>
    );
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-2">
      <input type="hidden" name={idField} value={id} />

      <div className="flex items-center gap-2">
        <Input
          name="name"
          type="text"
          required
          maxLength={maxLength}
          defaultValue={currentName}
          aria-label={`Nuevo nombre para ${currentName}`}
          className="h-8"
        />
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? "…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
      </div>

      {state.error !== undefined && (
        <p
          role="alert"
          aria-live="assertive"
          className="text-destructive text-xs"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
