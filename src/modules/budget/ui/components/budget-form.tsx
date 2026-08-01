"use client";

import { useActionState, useState } from "react";

import { parseAmountToMinorUnits } from "@shared/domain/money-input";
import {
  BUCKET_EXAMPLES,
  BUCKET_LABEL,
  BUCKET_ORDER,
} from "@shared/ui/bucket-labels";
import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface BudgetFormState {
  error?: string;
  saved?: boolean;
}

type BudgetActionFn = (
  prev: BudgetFormState,
  formData: FormData,
) => Promise<BudgetFormState>;

interface BudgetFormProps {
  action: BudgetActionFn;
  currencyLabel: string;
  initial: {
    percentages: { need: number; want: number; save: number };
    expectedIncomeMinorUnits: bigint;
    incomeMode: string;
  };
}

const initialState: BudgetFormState = {};
const MINOR_UNIT_EXPONENT = 2;

/**
 * The three IncomeMode values, with the consequence of each spelled out.
 *
 * THIS QUESTION WAS REMOVED FROM THE WIZARD, deliberately, and belongs here
 * instead: the answer only matters once someone has used the app for a month and
 * noticed how their buckets behave, which is exactly when they would come looking
 * for it. Asking during setup made it a coin flip.
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

function parsePercentage(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= 0 && value <= 100 ? value : null;
}

/** A bucket's share, floored in bigint — the engine's own rounding, not a second one. */
function share(incomeMinorUnits: bigint, percentage: number): bigint {
  return (incomeMinorUnits * BigInt(percentage)) / 100n;
}

const SOLES = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
});

function formatMinorUnits(minorUnits: bigint): string {
  return SOLES.format(Number(minorUnits) / 100);
}

function toAmountString(minorUnits: bigint): string {
  const whole = minorUnits / 100n;
  const cents = minorUnits % 100n;
  return cents === 0n
    ? String(whole)
    : `${whole}.${String(cents).padStart(2, "0")}`;
}

/**
 * Edit the whole budget in one form: split, expected income, income mode.
 *
 * ONE form rather than three, because budget_configs has no valid partial state and
 * every write is a whole row. Three forms would have been three read-modify-writes
 * racing over one row, and a person could have left the screen with a split saved
 * and an income not.
 *
 * Everything is pre-filled from what is stored, so this is an edit rather than a
 * re-entry — and the live preview shows the consequence before saving.
 */
export function BudgetForm({
  action,
  currencyLabel,
  initial,
}: BudgetFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  const [values, setValues] = useState({
    need: String(initial.percentages.need),
    want: String(initial.percentages.want),
    save: String(initial.percentages.save),
  });
  const [income, setIncome] = useState(
    toAmountString(initial.expectedIncomeMinorUnits),
  );

  const parsed = {
    need: parsePercentage(values.need),
    want: parsePercentage(values.want),
    save: parsePercentage(values.save),
  };
  const allValid =
    parsed.need !== null && parsed.want !== null && parsed.save !== null;
  const sum = allValid ? parsed.need! + parsed.want! + parsed.save! : null;
  const sumIsOk = sum === 100;

  const parsedIncome = parseAmountToMinorUnits(income, MINOR_UNIT_EXPONENT);
  const incomeMinorUnits =
    parsedIncome.ok && parsedIncome.value > 0n ? parsedIncome.value : null;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      {state.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {state.saved === true && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          Guardado. Los meses anteriores no cambian.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="expected-income">
          Ingreso del mes ({currencyLabel})
        </Label>
        <Input
          id="expected-income"
          name="expectedIncome"
          type="text"
          inputMode="decimal"
          required
          value={income}
          onChange={(event) => setIncome(event.target.value)}
        />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-foreground mb-2 text-sm font-medium">
          Cómo se reparte
        </legend>

        {BUCKET_ORDER.map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <Label htmlFor={`split-${key}`}>{BUCKET_LABEL[key]} (%)</Label>
            <Input
              id={`split-${key}`}
              name={key}
              type="text"
              inputMode="numeric"
              required
              value={values[key]}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: event.target.value,
                }))
              }
              aria-describedby={`split-${key}-hint`}
            />
            <p
              id={`split-${key}-hint`}
              className="text-muted-foreground text-xs"
            >
              {BUCKET_EXAMPLES[key]}
            </p>
          </div>
        ))}

        <p
          aria-live="polite"
          className={
            sumIsOk
              ? "text-muted-foreground text-sm"
              : "text-destructive text-sm font-medium"
          }
        >
          {sum === null
            ? "Escribe los tres porcentajes como números enteros."
            : sumIsOk
              ? "Suman 100 %."
              : `Suman ${sum} %. Tienen que sumar 100 %.`}
        </p>
      </fieldset>

      {incomeMinorUnits !== null && sumIsOk && (
        <div
          aria-live="polite"
          className="border-border bg-muted/30 flex flex-col gap-2 rounded-lg border p-4"
        >
          <p className="text-foreground text-sm font-medium">Así quedaría</p>
          {BUCKET_ORDER.map((key) => (
            <p
              key={key}
              className="text-muted-foreground flex items-baseline justify-between text-sm"
            >
              <span>
                {BUCKET_LABEL[key]}{" "}
                <span className="text-xs">({parsed[key]} %)</span>
              </span>
              <span className="text-foreground font-medium">
                {formatMinorUnits(share(incomeMinorUnits, parsed[key]!))}
              </span>
            </p>
          ))}
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground mb-2 text-sm font-medium">
          ¿Qué ingreso usamos para el cálculo?
        </legend>

        {INCOME_MODES.map((mode) => (
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
              defaultChecked={initial.incomeMode === mode.value}
              className="accent-primary mt-0.5 h-4 w-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground text-sm">{mode.label}</span>
              <span className="text-muted-foreground text-xs">{mode.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Button type="submit" disabled={isPending || !sumIsOk} className="w-full">
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
