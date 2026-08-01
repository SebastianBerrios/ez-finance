"use client";

import { useActionState, useEffect, useRef } from "react";

import type { Bucket } from "@shared/domain/budget-types";
import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface CategoryCreatorState {
  error?: string;
  created?: string;
}

type CreateActionFn = (
  prev: CategoryCreatorState,
  formData: FormData,
) => Promise<CategoryCreatorState>;

interface CategoryCreatorProps {
  action: CreateActionFn;
}

const initialState: CategoryCreatorState = {};

/** Wording matches step 1, where these three shares were introduced. */
const BUCKET_OPTIONS: readonly { value: Bucket; label: string }[] = [
  { value: "need", label: "Necesidades primarias" },
  { value: "want", label: "Caprichos" },
  { value: "save", label: "Ahorro para el futuro" },
];

/**
 * Add a category during setup.
 *
 * A SEPARATE form from the keep/uncheck list on purpose. Nesting them is invalid
 * HTML, and sharing one would mean adding a category and confirming the list were
 * the same submission — so you could not add two without leaving the step.
 *
 * The bucket is required and has no pre-selected value. A category with no bucket
 * is invisible to the 50/30/20 split, so a default here would quietly produce the
 * one shape that makes the dashboard look broken.
 */
export function CategoryCreator({ action }: CategoryCreatorProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const nameRef = useRef<HTMLInputElement>(null);

  // Clear and refocus after a successful add, so adding several in a row does not
  // mean deleting the previous name first.
  useEffect(() => {
    if (state.created !== undefined && nameRef.current !== null) {
      nameRef.current.value = "";
      nameRef.current.focus();
    }
  }, [state.created]);

  return (
    <details className="border-border mt-6 rounded-lg border">
      <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
        Agregar una categoría
      </summary>

      <form
        action={formAction}
        noValidate
        className="flex flex-col gap-4 px-4 pt-2 pb-4"
      >
        {state.error !== undefined && (
          <div
            role="alert"
            aria-live="assertive"
            className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
          >
            {state.error}
          </div>
        )}

        {state.created !== undefined && (
          <p aria-live="polite" className="text-muted-foreground text-sm">
            Agregamos «{state.created}» a tu lista.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="category-name">Nombre</Label>
          <Input
            ref={nameRef}
            id="category-name"
            name="name"
            type="text"
            required
            maxLength={60}
            placeholder="Mascotas"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="category-bucket">¿A qué parte pertenece?</Label>
          <select
            id="category-bucket"
            name="bucket"
            required
            defaultValue=""
            className="border-border bg-background text-foreground h-9 rounded-md border px-3 text-sm"
          >
            <option value="" disabled>
              Elige una
            </option>
            {BUCKET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="submit"
          variant="outline"
          disabled={isPending}
          className="w-full"
        >
          {isPending ? "Agregando…" : "Agregar"}
        </Button>
      </form>
    </details>
  );
}
