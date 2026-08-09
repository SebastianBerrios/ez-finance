"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface CategoryLimitState {
  error?: string;
  saved?: string;
  cleared?: string;
}

type LimitActionFn = (
  prev: CategoryLimitState,
  formData: FormData,
) => Promise<CategoryLimitState>;

export interface CategoryLimitOption {
  readonly id: string;
  readonly name: string;
  /** Already formatted as decimal text, or "" when no ceiling is set. */
  readonly limit: string;
}

interface CategoryLimitsProps {
  action: LimitActionFn;
  categories: readonly CategoryLimitOption[];
  currencyLabel: string;
}

const initialState: CategoryLimitState = {};

/**
 * Optional per-category ceilings (spec §5.6).
 *
 * COLLAPSED, and the wording matters as much as the field. This is the one part of the
 * budget that is opt-in: the 50/30/20 split answers "how much of my income goes where",
 * and a ceiling answers a narrower question most people never ask. An always-open list
 * of every category with an empty box next to it reads as eleven things left undone.
 *
 * ONE FORM PER ROW rather than one form for all of them. A single submit would make
 * "clear the groceries ceiling" and "raise the transport one" the same transaction, so a
 * refusal on either would discard both — and the person could not tell which failed.
 *
 * AN EMPTY FIELD CLEARS. It is the only intuitive meaning of erasing the number, and
 * zero is refused everywhere below this (the use case, the column) because a ceiling of
 * zero is a prohibition: the engine would call every peso spent over budget. Someone who
 * means that archives the category.
 */
export function CategoryLimits({
  action,
  categories,
  currencyLabel,
}: CategoryLimitsProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <details className="border-border rounded-lg border">
      <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
        Límites por categoría (opcional)
      </summary>

      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Un techo para una categoría. Cuando lo que gastás se acerca o lo pasa,
          aparece un aviso en el panel. Dejá el campo vacío para quitarlo.
        </p>

        {state.error !== undefined && (
          <div
            role="alert"
            aria-live="assertive"
            className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs"
          >
            {state.error}
          </div>
        )}

        {state.saved !== undefined && (
          <p aria-live="polite" className="text-muted-foreground text-xs">
            Guardamos el límite de «{state.saved}».
          </p>
        )}

        {state.cleared !== undefined && (
          <p aria-live="polite" className="text-muted-foreground text-xs">
            «{state.cleared}» ya no tiene límite.
          </p>
        )}

        {categories.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Todavía no tenés categorías de gasto.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {categories.map((category) => (
              <li key={category.id}>
                <form
                  action={formAction}
                  noValidate
                  className="flex flex-col gap-1"
                >
                  <Label htmlFor={`limit-${category.id}`}>
                    {category.name}
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="hidden"
                      name="categoryId"
                      value={category.id}
                    />
                    <input
                      type="hidden"
                      name="categoryName"
                      value={category.name}
                    />
                    <Input
                      id={`limit-${category.id}`}
                      name="limit"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={`Sin límite (${currencyLabel})`}
                      defaultValue={category.limit}
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      aria-label={`Guardar límite de ${category.name}`}
                    >
                      Guardar
                    </Button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
