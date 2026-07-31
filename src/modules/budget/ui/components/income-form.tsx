"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface IncomeFormState {
  error?: string;
}

type IncomeActionFn = (
  prev: IncomeFormState,
  formData: FormData,
) => Promise<IncomeFormState>;

interface IncomeFormProps {
  action: IncomeActionFn;
  currencyLabel: string;
}

const initialState: IncomeFormState = {};

/**
 * The engine's three IncomeMode values, with the consequence of each spelled out.
 *
 * This is the setting most likely to make someone think the dashboard is broken:
 * under "real" everything reads 0 % until money actually arrives. Saying so next
 * to the option is cheaper than explaining it later.
 */
const INCOME_MODES: readonly {
  value: string;
  label: string;
  hint: string;
}[] = [
  {
    value: "mayor",
    label: "El mayor de los dos",
    hint: "Usa el ingreso real si ya superó al esperado. Recomendado.",
  },
  {
    value: "real",
    label: "Solo lo que ya recibí",
    hint: "Estricto: a inicio de mes verás todo en 0 %.",
  },
  {
    value: "esperado",
    label: "Siempre lo esperado",
    hint: "Los cubos no se mueven aunque cobres antes o después.",
  },
];

export function IncomeForm({ action, currencyLabel }: IncomeFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
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
        <Label htmlFor="expected-income">Ingreso del mes ({currencyLabel})</Label>
        <Input
          id="expected-income"
          name="expectedIncome"
          type="text"
          inputMode="decimal"
          required
          placeholder="3500"
          aria-describedby="expected-income-hint"
        />
        <p id="expected-income-hint" className="text-muted-foreground text-xs">
          Si todavía no lo sabes, escribe 0 y ajústalo después.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground mb-2 text-sm font-medium">
          ¿Qué ingreso usamos para el cálculo?
        </legend>

        {INCOME_MODES.map((mode, index) => (
          <label
            key={mode.value}
            htmlFor={`income-mode-${mode.value}`}
            className="border-border hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 transition-colors"
          >
            <input
              id={`income-mode-${mode.value}`}
              type="radio"
              name="incomeMode"
              value={mode.value}
              defaultChecked={index === 0}
              className="accent-primary mt-0.5 h-4 w-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground text-sm">{mode.label}</span>
              <span className="text-muted-foreground text-xs">{mode.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : "Continuar"}
      </Button>
    </form>
  );
}
