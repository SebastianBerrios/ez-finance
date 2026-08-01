"use client";

import { useActionState } from "react";

import type { CategorySummary } from "@/modules/categories/application/ports/category-port";
import type { Bucket } from "@shared/domain/budget-types";
import { BUCKET_LABEL, BUCKET_ORDER } from "@shared/ui/bucket-labels";
import { Button } from "@shared/ui/button";

export interface ArchiveCategoryState {
  error?: string;
  archived?: string;
}

type ArchiveActionFn = (
  prev: ArchiveCategoryState,
  formData: FormData,
) => Promise<ArchiveCategoryState>;

export interface RestoreCategoryState {
  error?: string;
  restored?: string;
}

type RestoreActionFn = (
  prev: RestoreCategoryState,
  formData: FormData,
) => Promise<RestoreCategoryState>;

interface CategoryManagerProps {
  action: ArchiveActionFn;
  restoreAction: RestoreActionFn;
  categories: readonly CategorySummary[];
}

const initialState: ArchiveCategoryState = {};
const restoreInitialState: RestoreCategoryState = {};

/**
 * The managed list: every active category, grouped by bucket, each with a way out.
 *
 * A DIFFERENT COMPONENT from CategoryPicker even though both list categories,
 * because they answer different questions. The picker asks "which of these do you
 * want?" and submits one decision about all of them at once — right for setup, and
 * wrong here, where archiving one thing should not require confirming the other
 * ten. This one acts per row.
 *
 * Archived categories are shown, greyed and without a button. Hiding them would
 * suggest they stopped existing, when in fact they still count in every month they
 * have transactions in — and someone who archived by mistake needs to see that it
 * happened.
 */
export function CategoryManager({
  action,
  restoreAction,
  categories,
}: CategoryManagerProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [restoreState, restoreFormAction, isRestoring] = useActionState(
    restoreAction,
    restoreInitialState,
  );

  const active = categories.filter((category) => !category.archived);
  const archived = categories.filter((category) => category.archived);

  const inBucket = (bucket: Bucket) =>
    active.filter((category) => category.bucket === bucket);

  // Categories with no bucket are real — the engine totals them and puts them in
  // none of the three — so they are listed rather than hidden, under a heading that
  // says what that means for the budget.
  const unbucketed = active.filter((category) => category.bucket === null);

  return (
    <div className="flex flex-col gap-6">
      {state.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {state.archived !== undefined && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          Archivamos «{state.archived}». Sigue contando en los meses donde ya
          tiene movimientos.
        </p>
      )}

      {BUCKET_ORDER.map((bucket) => {
        const rows = inBucket(bucket);
        if (rows.length === 0) return null;

        return (
          <section key={bucket} className="flex flex-col gap-2">
            <h2 className="text-foreground text-sm font-medium">
              {BUCKET_LABEL[bucket]}
            </h2>

            {rows.map((category) => (
              <div
                key={category.id}
                className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span className="text-foreground text-sm">{category.name}</span>

                <form action={formAction}>
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input
                    type="hidden"
                    name="categoryName"
                    value={category.name}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    aria-label={`Archivar ${category.name}`}
                  >
                    Archivar
                  </Button>
                </form>
              </div>
            ))}
          </section>
        );
      })}

      {unbucketed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-foreground text-sm font-medium">Sin cubo</h2>
          <p className="text-muted-foreground text-xs">
            Los gastos con estas categorías se registran, pero no entran en
            ninguno de los tres cubos.
          </p>

          {unbucketed.map((category) => (
            <div
              key={category.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <span className="text-foreground text-sm">{category.name}</span>

              <form action={formAction}>
                <input type="hidden" name="categoryId" value={category.id} />
                <input
                  type="hidden"
                  name="categoryName"
                  value={category.name}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  aria-label={`Archivar ${category.name}`}
                >
                  Archivar
                </Button>
              </form>
            </div>
          ))}
        </section>
      )}

      {restoreState.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {restoreState.error}
        </div>
      )}

      {restoreState.restored !== undefined && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          «{restoreState.restored}» vuelve a estar disponible.
        </p>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">
            Archivadas
          </h2>
          <p className="text-muted-foreground text-xs">
            Ya no se ofrecen para movimientos nuevos, y siguen contando en los
            meses donde tienen historia.
          </p>

          {archived.map((category) => (
            <div
              key={category.id}
              className="border-border/60 text-muted-foreground flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm"
            >
              <span>{category.name}</span>

              {/*
                The way back. Archivar sits next to every active row, so pressing it
                by accident is easy — and until this existed there was nothing to
                press afterwards.
              */}
              <form action={restoreFormAction}>
                <input type="hidden" name="categoryId" value={category.id} />
                <input
                  type="hidden"
                  name="categoryName"
                  value={category.name}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  disabled={isRestoring}
                  aria-label={`Restaurar ${category.name}`}
                >
                  Restaurar
                </Button>
              </form>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
