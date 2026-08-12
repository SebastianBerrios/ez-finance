"use client";

import { useActionState, useState } from "react";

import type { Bucket } from "@shared/domain/budget-types";
import { BUCKET_LABEL } from "@shared/ui/bucket-labels";
import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

/**
 * Declared HERE rather than imported from the accounts and categories modules, the same
 * way transaction-form.tsx does: eslint-plugin-boundaries forbids one module reaching
 * into another's application layer, and a form that consumed AccountSummary would break
 * whenever that port changed shape for reasons unrelated to splitting an expense.
 */
export interface SplitAccountOption {
  readonly id: string;
  readonly name: string;
}

export interface SplitCategoryOption {
  readonly id: string;
  readonly name: string;
  readonly bucket: Bucket | null;
}

export interface SplitFormState {
  error?: string;
}

type SplitActionFn = (
  prev: SplitFormState,
  formData: FormData,
) => Promise<SplitFormState>;

interface SplitFormProps {
  action: SplitActionFn;
  accounts: readonly SplitAccountOption[];
  categories: readonly SplitCategoryOption[];
  currencyLabel: string;
  /** Today as YYYY-MM-DD, resolved on the server so the two never disagree. */
  today: string;
}

const initialState: SplitFormState = {};

/** One debtor row. `key` is local only — the server reads the arrays by position. */
interface DebtorRow {
  readonly key: number;
}

export function SplitForm({
  action,
  accounts,
  categories,
  currencyLabel,
  today,
}: SplitFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  // One row to start: the common case is splitting with one person.
  const [rows, setRows] = useState<readonly DebtorRow[]>([{ key: 0 }]);
  const [nextKey, setNextKey] = useState(1);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      <p className="text-muted-foreground text-xs leading-relaxed">
        Registrá lo que pagaste vos y cuánto te debe cada persona.{" "}
        <span className="text-foreground">Solo tu parte</span> consume tu
        presupuesto; el resto queda como algo que te deben, no como un gasto
        tuyo.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="split-my-share">Tu parte ({currencyLabel})</Label>
        <Input
          id="split-my-share"
          name="myShare"
          type="text"
          inputMode="decimal"
          required
          placeholder="25.50"
        />
        <p className="text-muted-foreground text-xs">
          Puede ser 0 si pagaste algo que no consumiste.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="split-account">Cuenta que pagó</Label>
        <select
          id="split-account"
          name="accountId"
          required
          className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      {/*
        Only the SHARE is categorised, because only the share reaches a bucket. What the
        others owe is not spending of yours, so asking which bucket it belongs to would
        be asking the wrong question — the same reason income carries no category.
      */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="split-category">Categoría de tu parte</Label>
        <select
          id="split-category"
          name="categoryId"
          className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <option value="">Sin categoría</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.bucket === null
                ? ""
                : ` · ${BUCKET_LABEL[category.bucket] ?? ""}`}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="border-border flex flex-col gap-3 rounded-lg border p-3">
        <legend className="text-foreground px-1 text-sm font-medium">
          Quién te debe
        </legend>

        {rows.map((row, index) => (
          <div key={row.key} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`debtor-name-${row.key}`}>Nombre</Label>
              <Input
                id={`debtor-name-${row.key}`}
                name="debtorName"
                type="text"
                required
                maxLength={80}
                autoComplete="off"
                placeholder="Ana"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`debtor-amount-${row.key}`}>Debe</Label>
              <Input
                id={`debtor-amount-${row.key}`}
                name="debtorAmount"
                type="text"
                inputMode="decimal"
                required
                placeholder="25.50"
              />
            </div>
            {/*
              The last row cannot be removed: a split with nobody owing is an ordinary
              expense, and the app has a screen for that. Enforced again in the domain
              and once more in the RPC.
            */}
            {rows.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Quitar persona ${index + 1}`}
                onClick={() =>
                  setRows(rows.filter((candidate) => candidate.key !== row.key))
                }
              >
                Quitar
              </Button>
            )}
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRows([...rows, { key: nextKey }]);
            setNextKey(nextKey + 1);
          }}
        >
          Agregar otra persona
        </Button>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="split-date">Fecha</Label>
        <Input
          id="split-date"
          name="occurredOn"
          type="date"
          required
          defaultValue={today}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="split-note">Nota (opcional)</Label>
        <Input
          id="split-note"
          name="note"
          type="text"
          maxLength={500}
          autoComplete="off"
          placeholder="Asado del sábado"
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : "Registrar gasto dividido"}
      </Button>
    </form>
  );
}
