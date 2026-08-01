"use client";

import { useActionState, useState } from "react";

import type { Bucket } from "@shared/domain/budget-types";
import { BUCKET_LABEL } from "@shared/ui/bucket-labels";
import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

/**
 * What this form needs to render a picker — declared HERE rather than imported
 * from the accounts and categories modules.
 *
 * eslint-plugin-boundaries forbids one module reaching into another's application
 * layer, and it is right to: a form that consumed AccountSummary would break
 * whenever the accounts port changed shape, for a reason having nothing to do with
 * recording a movement. The page composes the two and adapts, which is the
 * delivery layer's job.
 */
export interface AccountOption {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  /**
   * `Bucket`, not `string`. It was the looser type, which is what let this file
   * carry its own label map keyed by string — and drift from the names every other
   * screen used. The value has always come from CategorySummary, where it is
   * already narrowed; null remains the engine's unbucketed case.
   */
  readonly bucket: Bucket | null;
  readonly archived: boolean;
}

export interface TransactionFormState {
  error?: string;
}

type TransactionActionFn = (
  prev: TransactionFormState,
  formData: FormData,
) => Promise<TransactionFormState>;

interface TransactionFormProps {
  action: TransactionActionFn;
  accounts: readonly AccountOption[];
  categories: readonly CategoryOption[];
  currencyLabel: string;
  /** Today as YYYY-MM-DD, resolved on the server so the two never disagree. */
  today: string;
}

const initialState: TransactionFormState = {};

export function TransactionForm({
  action,
  accounts,
  categories,
  currencyLabel,
  today,
}: TransactionFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [kind, setKind] = useState<"expense" | "income">("expense");

  // Archived rows stay OUT of the pickers but keep counting in past months — the
  // engine reads them, this form just does not offer them for new movements.
  const openAccounts = accounts.filter((account) => !account.archived);
  const openCategories = categories.filter((category) => !category.archived);

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

      {/*
        Expense first and preselected: it is the movement people record many times
        a day, and income is a handful of times a month. The order is the frequency.
      */}
      <fieldset className="flex gap-2">
        <legend className="sr-only">Tipo de movimiento</legend>
        {(
          [
            { value: "expense", label: "Gasto" },
            { value: "income", label: "Ingreso" },
          ] as const
        ).map((option) => (
          <label
            key={option.value}
            htmlFor={`kind-${option.value}`}
            className={
              kind === option.value
                ? "border-primary bg-primary/10 text-foreground flex flex-1 cursor-pointer items-center justify-center rounded-md border px-4 py-3 text-sm font-medium"
                : "border-border text-muted-foreground hover:bg-muted/40 flex flex-1 cursor-pointer items-center justify-center rounded-md border px-4 py-3 text-sm transition-colors"
            }
          >
            <input
              id={`kind-${option.value}`}
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
        <Label htmlFor="tx-amount">Monto ({currencyLabel})</Label>
        <Input
          id="tx-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          required
          placeholder="25.50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tx-account">Cuenta</Label>
        <select
          id="tx-account"
          name="accountId"
          required
          className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {openAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      {/*
        Only expenses carry a category, because that is what the 50/30/20 buckets
        measure — income is the DENOMINATOR of the calculation, not one of its
        parts, so asking which bucket it belongs to would be asking the wrong
        question.
      */}
      {kind === "expense" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="tx-category">Categoría</Label>
          <select
            id="tx-category"
            name="categoryId"
            className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <option value="">Sin categoría</option>
            {openCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.bucket === null
                  ? ""
                  : ` · ${BUCKET_LABEL[category.bucket] ?? ""}`}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Sin categoría el gasto se registra, pero no entra en ningún cubo.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="tx-date">Fecha</Label>
        <Input
          id="tx-date"
          name="occurredOn"
          type="date"
          required
          defaultValue={today}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tx-note">Nota (opcional)</Label>
        <Input
          id="tx-note"
          name="note"
          type="text"
          maxLength={500}
          autoComplete="off"
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : "Registrar"}
      </Button>
    </form>
  );
}
