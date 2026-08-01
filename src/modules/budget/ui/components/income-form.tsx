"use client";

import { useActionState, useState } from "react";

import { parseAmountToMinorUnits } from "@shared/domain/money-input";
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
  /**
   * The split chosen at step 1, used to turn the typed income into soles per
   * bucket as it is typed. This is what the removed standalone split step used to
   * show; folding it in here means the person sees the consequence without
   * answering an extra screen.
   */
  percentages: { need: number; want: number; save: number };
  submitLabel: string;
}

const initialState: IncomeFormState = {};

const MINOR_UNIT_EXPONENT = 2;

const PREVIEW_ROWS = [
  { key: "need" as const, label: "Necesidades primarias" },
  { key: "want" as const, label: "Caprichos" },
  { key: "save" as const, label: "Ahorro para el futuro" },
];

/**
 * A bucket's share, in minor units, floored — matching how the engine derives a
 * target rather than inventing a second rounding rule for the preview.
 */
function share(incomeMinorUnits: bigint, percentage: number): bigint {
  return (incomeMinorUnits * BigInt(percentage)) / 100n;
}

/**
 * Format minor units as soles.
 *
 * The division happens in bigint, so the split itself is exact; only the final
 * display crosses into Number, where an income would have to exceed ~90 trillion
 * soles to lose a cent. This is a preview — the stored value is whatever the
 * server writes from the same parsed bigint.
 */
const SOLES = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
});

function formatMinorUnits(minorUnits: bigint): string {
  return SOLES.format(Number(minorUnits) / 100);
}

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

export function IncomeForm({
  action,
  currencyLabel,
  percentages,
  submitLabel,
}: IncomeFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [raw, setRaw] = useState("");

  // null while the field is empty or not yet a valid amount, which is the state
  // the preview stays silent in rather than showing S/ 0.00 for every keystroke.
  const parsed = parseAmountToMinorUnits(raw, MINOR_UNIT_EXPONENT);
  const income = parsed.ok && parsed.value > 0n ? parsed.value : null;

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
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          aria-describedby="expected-income-hint"
        />
        <p id="expected-income-hint" className="text-muted-foreground text-xs">
          Es la base del cálculo: tus tres cubos se miden contra este monto.
        </p>
      </div>

      {/*
        Announced politely: it changes on every keystroke, and an assertive live
        region would interrupt a screen reader mid-word each time.
      */}
      {income !== null && (
        <div
          aria-live="polite"
          className="border-border bg-muted/30 flex flex-col gap-2 rounded-lg border p-4"
        >
          <p className="text-foreground text-sm font-medium">
            Así queda tu mes
          </p>
          {PREVIEW_ROWS.map((row) => (
            <p
              key={row.key}
              className="text-muted-foreground flex items-baseline justify-between text-sm"
            >
              <span>
                {row.label}{" "}
                <span className="text-xs">({percentages[row.key]} %)</span>
              </span>
              <span className="text-foreground font-medium">
                {formatMinorUnits(share(income, percentages[row.key]))}
              </span>
            </p>
          ))}
        </div>
      )}

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
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
