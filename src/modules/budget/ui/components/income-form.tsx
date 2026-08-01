"use client";

import { useActionState, useState } from "react";

import { parseAmountToMinorUnits } from "@shared/domain/money-input";
import { BUCKET_LABEL, BUCKET_ORDER } from "@shared/ui/bucket-labels";
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

/*
 * NO INCOME-MODE QUESTION HERE, deliberately.
 *
 * This form used to also ask which income the engine should measure against —
 * `mayor`, `real` or `esperado` — three options with consequences subtle enough
 * that the answer was a coin flip for anyone who had not used the app yet.
 *
 * The default already does what almost everyone means. `mayor` resolves to
 * max(income received, income expected), so someone who states their salary and
 * later records extra earnings sees the buckets GROW when that money actually
 * arrives, and never shrink below the salary. `real` would show 0 % until payday;
 * `esperado` would ignore the extra. Neither is the common case.
 *
 * The engine still supports all three and income-resolver.test.ts still covers
 * them; what is gone is asking during setup. A control for the minority who want
 * another mode belongs in settings, and is NOT built yet — so today every
 * workspace configured through this wizard is on `mayor`.
 */

const PREVIEW_ROWS = BUCKET_ORDER.map((key) => ({
  key,
  label: BUCKET_LABEL[key],
}));

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
        <Label htmlFor="expected-income">
          Ingreso del mes ({currencyLabel})
        </Label>
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

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
