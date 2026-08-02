"use client";

import { useActionState, useState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface CreateScheduledState {
  error?: string;
  created?: string;
}

type CreateActionFn = (
  prev: CreateScheduledState,
  formData: FormData,
) => Promise<CreateScheduledState>;

/** Declared here rather than imported from two other modules' ports — the page adapts. */
export interface Option {
  readonly id: string;
  readonly name: string;
}

interface ScheduledCreatorProps {
  action: CreateActionFn;
  accounts: readonly Option[];
  categories: readonly Option[];
  currencyLabel: string;
}

const initialState: CreateScheduledState = {};

export function ScheduledCreator({
  action,
  accounts,
  categories,
  currencyLabel,
}: ScheduledCreatorProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [kind, setKind] = useState<"expense" | "income">("expense");

  return (
    <details className="border-border rounded-lg border">
      <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
        Programar un movimiento
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
            Programamos «{state.created}».
          </p>
        )}

        {/* Expense first and preselected: the frequency argument, same as the movement form. */}
        <fieldset className="flex gap-2">
          <legend className="sr-only">Tipo</legend>
          {(
            [
              { value: "expense", label: "Gasto" },
              { value: "income", label: "Ingreso" },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              htmlFor={`sched-kind-${option.value}`}
              className={
                kind === option.value
                  ? "border-primary bg-primary/10 text-foreground flex flex-1 cursor-pointer items-center justify-center rounded-md border px-4 py-3 text-sm font-medium"
                  : "border-border text-muted-foreground hover:bg-muted/40 flex flex-1 cursor-pointer items-center justify-center rounded-md border px-4 py-3 text-sm transition-colors"
              }
            >
              <input
                id={`sched-kind-${option.value}`}
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sched-name">Nombre</Label>
          <Input
            id="sched-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="Alquiler"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sched-amount">Monto ({currencyLabel})</Label>
          <Input
            id="sched-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="1500"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sched-day">Día del mes</Label>
          <Input
            id="sched-day"
            name="dayOfMonth"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={1}
            aria-describedby="sched-day-hint"
          />
          <p id="sched-day-hint" className="text-muted-foreground text-xs">
            Si eliges 31, en los meses más cortos se registra el último día.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sched-account">Cuenta</Label>
          <select
            id="sched-account"
            name="accountId"
            required
            defaultValue=""
            className="border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm"
          >
            <option value="" disabled>
              Elige una
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        {/* Only expenses carry a category — income is the denominator, not a bucket. */}
        {kind === "expense" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sched-category">Categoría</Label>
            <select
              id="sched-category"
              name="categoryId"
              className="border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm"
            >
              <option value="">Sin categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <Button
          type="submit"
          variant="outline"
          disabled={isPending}
          className="w-full"
        >
          {isPending ? "Programando…" : "Programar"}
        </Button>
      </form>
    </details>
  );
}
