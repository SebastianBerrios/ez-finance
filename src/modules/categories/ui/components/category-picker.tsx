"use client";

import { useActionState } from "react";

import type { CategorySummary } from "@/modules/categories/application/ports/category-port";
import type { Bucket } from "@shared/domain/budget-types";
import { BUCKET_LABEL, BUCKET_ORDER } from "@shared/ui/bucket-labels";
import { Button } from "@shared/ui/button";

export interface CategoryPickerState {
  error?: string;
}

type KeepActionFn = (
  prev: CategoryPickerState,
  formData: FormData,
) => Promise<CategoryPickerState>;

interface CategoryPickerProps {
  action: KeepActionFn;
  categories: readonly CategorySummary[];
}

const initialState: CategoryPickerState = {};

export function CategoryPicker({ action, categories }: CategoryPickerProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  const active = categories.filter((category) => !category.archived);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {BUCKET_ORDER.map((bucket) => {
        const inBucket = active.filter(
          (category) => category.bucket === bucket,
        );
        if (inBucket.length === 0) return null;

        return (
          <fieldset key={bucket} className="flex flex-col gap-2">
            <legend className="text-foreground mb-1 text-sm font-medium">
              {BUCKET_LABEL[bucket]}
            </legend>

            {inBucket.map((category) => (
              <label
                key={category.id}
                htmlFor={`keep-${category.id}`}
                className="border-border hover:bg-muted/40 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors"
              >
                <input
                  id={`keep-${category.id}`}
                  type="checkbox"
                  name="keep"
                  value={category.id}
                  defaultChecked
                  className="accent-primary h-4 w-4"
                />
                <span className="text-foreground">{category.name}</span>
              </label>
            ))}
          </fieldset>
        );
      })}

      {/*
        Categories with no bucket are not offered here. The seeded set has none,
        and an unbucketed category is an edge case the engine tolerates rather
        than something to invite during setup.
      */}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : "Continuar"}
      </Button>
    </form>
  );
}
