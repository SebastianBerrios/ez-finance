"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface AccountFormState {
  error?: string;
}

type AccountActionFn = (
  prev: AccountFormState,
  formData: FormData,
) => Promise<AccountFormState>;

interface AccountFormProps {
  action: AccountActionFn;
  /** Shown as static text, not a field — see the note below. */
  currencyLabel: string;
}

const initialState: AccountFormState = {};

/**
 * Spanish labels for the engine's AccountType values.
 *
 * "Ahorro" is its own type rather than a flag on bank/investment because the
 * engine derives isSavings from it, and transfers INTO a savings account count as
 * consumption of the 20 % bucket. Choosing it here is therefore a budgeting
 * decision, not a cosmetic one, which is what the hint text says.
 */
const ACCOUNT_TYPES: readonly { value: string; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "bank", label: "Cuenta bancaria" },
  { value: "card", label: "Tarjeta de crédito" },
  { value: "wallet", label: "Billetera digital" },
  { value: "investment", label: "Inversión" },
  { value: "savings", label: "Ahorro" },
];

export function AccountForm({ action, currencyLabel }: AccountFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
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
        <Label htmlFor="account-name">Nombre</Label>
        <Input
          id="account-name"
          name="name"
          type="text"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Efectivo"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="account-type">Tipo</Label>
        <select
          id="account-type"
          name="type"
          required
          defaultValue="cash"
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {ACCOUNT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <p id="account-type-hint" className="text-muted-foreground text-xs">
          Si eliges <strong>Ahorro</strong>, lo que transfieras hacia esta cuenta
          cuenta como ahorro del mes.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="account-balance">Saldo actual ({currencyLabel})</Label>
        <Input
          id="account-balance"
          name="initialBalance"
          type="text"
          inputMode="decimal"
          required
          defaultValue="0"
          aria-describedby="account-balance-hint"
        />
        <p id="account-balance-hint" className="text-muted-foreground text-xs">
          Cuánto hay ahora mismo. Si es una tarjeta con deuda, escríbelo en
          negativo.
        </p>
      </div>

      {/*
        The currency is NOT a field. The app operates in a single currency, and
        this first account fixes the workspace's base currency permanently — every
        amount ever stored is denominated against it. Offering a choice that
        cannot be undone, in a wizard, for a decision the product has already
        made, would be all cost and no benefit.
      */}
      <p className="text-muted-foreground text-xs">
        Tu espacio va a trabajar en {currencyLabel}.
      </p>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : "Continuar"}
      </Button>
    </form>
  );
}
