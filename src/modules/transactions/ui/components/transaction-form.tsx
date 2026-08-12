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

/**
 * What an EXISTING movement puts in the fields.
 *
 * `amount` is a string, already formatted by formatMinorUnitsForInput, because this
 * is the value of a text input and the round trip has to be exact: opening a
 * movement and saving it untouched must not change the figure.
 */
export interface TransactionFormInitialValues {
  /** Submitted back in a hidden field; the action re-checks it against the session. */
  readonly id: string;
  readonly kind: "income" | "expense";
  readonly amount: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly occurredOn: string;
  readonly note: string | null;
}

/**
 * What makes this form work without a connection.
 *
 * A CALLBACK RATHER THAN THE QUEUE ITSELF: the queue is IndexedDB, this is a component,
 * and the layer that owns adapters is the delivery layer. Absent means the form is
 * online-only, which is the correct behaviour for every screen that has no offline story
 * — the person gets the ordinary "no pudimos guardar" instead of a false promise.
 */
export interface OfflineSubmit {
  /** Stores the write. False means it could NOT be stored — never report that as saved. */
  readonly enqueue: (form: FormData) => Promise<boolean>;
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
  /** Absent when recording; present when correcting an existing movement. */
  initial?: TransactionFormInitialValues;
  submitLabel?: string;
  /** Absent when the screen has no offline story. See OfflineSubmit. */
  offline?: OfflineSubmit;
}

const initialState: TransactionFormState = {};

/**
 * Open options, PLUS whichever one the movement already points at.
 *
 * Archived rows stay out of the pickers — the engine keeps reading them for past
 * months, this form simply does not offer them for new movements. But an edit is not
 * a new movement: a movement recorded in June against an account archived in July
 * still belongs to that account, and dropping it from the list would silently move
 * the movement to whatever option happened to be first the moment someone pressed
 * save. So the current selection is always offered, archived or not.
 */
function selectable<T extends { id: string; archived: boolean }>(
  options: readonly T[],
  selectedId: string | null | undefined,
): readonly T[] {
  return options.filter(
    (option) => !option.archived || option.id === selectedId,
  );
}

export function TransactionForm({
  action,
  accounts,
  categories,
  currencyLabel,
  today,
  initial,
  submitLabel = "Registrar",
  offline,
}: TransactionFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [kind, setKind] = useState<"expense" | "income">(
    initial?.kind ?? "expense",
  );
  const [queued, setQueued] = useState<"saved" | "failed" | null>(null);

  const openAccounts = selectable(accounts, initial?.accountId);
  const openCategories = selectable(categories, initial?.categoryId);

  /**
   * The offline path, and the ONE place it can be decided: at submit time.
   *
   * Checked here rather than by disabling the button, because the connection can drop
   * between opening the form and pressing save — which on a phone is the normal case, not
   * the edge one. React skips the server action when the submit event is prevented, so
   * this is a genuine fork rather than a race with it.
   *
   * navigator.onLine is a WEAK signal (it means "there is a network interface", not "the
   * server is reachable"), and it is used only in the direction where it is reliable:
   * false really does mean a request would fail. When it lies the other way, the write
   * goes out normally and the sender's own failure handling queues nothing — the person
   * gets the ordinary error, which is the same behaviour as before.
   */
  async function handleOfflineSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    if (offline === undefined) return;
    if (navigator.onLine) return;

    event.preventDefault();
    const form = event.currentTarget;
    const stored = await offline.enqueue(new FormData(form));

    setQueued(stored ? "saved" : "failed");

    // Cleared only when RECORDING: the next movement starts from an empty form. An edit
    // keeps its values, because the person is looking at a correction they just made and
    // an emptied edit form would look like it lost it.
    if (stored && initial === undefined) form.reset();
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => void handleOfflineSubmit(event)}
      noValidate
      className="flex flex-col gap-5"
    >
      {/*
        Only when correcting. The server does not trust it — it scopes the UPDATE to
        the current workspace and the policy scopes it to rows the caller authored —
        but the form has to name WHICH movement it is saving.
      */}
      {initial !== undefined && (
        <input type="hidden" name="transactionId" value={initial.id} />
      )}

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
        SAYS WHERE IT IS, not just "guardado". Someone who reads a plain confirmation and
        then does not see the movement in a list on another device would reasonably
        conclude the app lost it.
      */}
      {queued === "saved" && (
        <div
          role="status"
          aria-live="polite"
          className="bg-muted/60 text-foreground rounded-lg px-4 py-3 text-sm"
        >
          Guardado en este dispositivo. Se va a sincronizar cuando vuelvas a
          tener conexión.
        </div>
      )}

      {/*
        The queue itself failed — no IndexedDB, private mode, storage full. This has to be
        a REFUSAL and not a reassurance: promising that a movement is safe when nothing
        stored it is the one outcome that loses money silently.
      */}
      {queued === "failed" && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos guardarlo en este dispositivo. Anotalo y registralo cuando
          tengas conexión.
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
          defaultValue={initial?.amount}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tx-account">Cuenta</Label>
        <select
          id="tx-account"
          name="accountId"
          required
          defaultValue={initial?.accountId}
          className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {openAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
              {account.archived ? " · archivada" : ""}
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
            defaultValue={initial?.categoryId ?? ""}
            className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <option value="">Sin categoría</option>
            {openCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.bucket === null
                  ? ""
                  : ` · ${BUCKET_LABEL[category.bucket] ?? ""}`}
                {category.archived ? " · archivada" : ""}
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
          defaultValue={initial?.occurredOn ?? today}
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
          defaultValue={initial?.note ?? ""}
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
