"use client";

import { useActionState } from "react";

import type { OwedSplit } from "@/modules/splits/application/ports/split-port";
import { type Money, fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { Button } from "@shared/ui/button";
import { MoneyDisplay } from "@shared/ui/money-display";

export interface SettleState {
  error?: string;
  /**
   * A flag rather than the debtor's name. The RPC returns nothing to name them with,
   * and the alternative — a hidden field the browser sends back — would be echoing a
   * string the client controls just to make one sentence friendlier.
   */
  settled?: boolean;
}

type SettleActionFn = (
  prev: SettleState,
  formData: FormData,
) => Promise<SettleState>;

export interface SettleAccountOption {
  readonly id: string;
  readonly name: string;
}

interface OwedListProps {
  splits: readonly OwedSplit[];
  accounts: readonly SettleAccountOption[];
  settleAction: SettleActionFn;
  currency: string;
}

const initialState: SettleState = {};

/**
 * Who still owes you, and what has already come back.
 *
 * ONE FORM PER ROW, and the destination account is a select inside it. Someone can pay
 * you in cash for something you put on a card, so the account the money lands in is a
 * choice — forcing the account that paid would record money arriving where it did not.
 *
 * Settled rows stay, greyed, below the open ones. They are the proof the debt closed,
 * and a list that erased them would leave someone wondering whether they had recorded
 * the repayment at all.
 */
export function OwedList({
  splits,
  accounts,
  settleAction,
  currency,
}: OwedListProps) {
  const [state, formAction, isPending] = useActionState(
    settleAction,
    initialState,
  );

  function money(minorUnits: bigint): Money {
    const value = fromMinorUnits(currency, minorUnits);
    return value.ok ? value.value : expectOk(fromMinorUnits("PEN", 0n));
  }

  const open = splits.filter((split) => !split.settled);
  const closed = splits.filter((split) => split.settled);

  const owedTotal = open.reduce(
    (sum, split) => sum + split.amountMinorUnits,
    0n,
  );

  return (
    <div className="flex flex-col gap-4">
      {state.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {state.settled === true && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          Lo marcamos como cobrado. La plata entró en la cuenta que elegiste.
        </p>
      )}

      {open.length === 0 ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          Nadie te debe nada ahora mismo. Cuando registres un gasto dividido,
          acá vas a ver quién tiene que devolverte.
        </p>
      ) : (
        <>
          {/*
            The total first, because "cuánto me deben en total" is the question people
            arrive with. It matches the balance of the "Por cobrar" account by
            construction: both are the same rows.
          */}
          <section className="bg-card border-border rounded-xl border p-5">
            <p className="text-muted-foreground text-xs tracking-widest uppercase">
              Te deben en total
            </p>
            <p className="mt-2">
              <MoneyDisplay amount={money(owedTotal)} size="xl" />
            </p>
          </section>

          <ul className="divide-border flex flex-col divide-y">
            {open.map((split) => (
              <li key={split.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-foreground text-sm font-medium">
                    {split.debtorName}
                  </span>
                  <MoneyDisplay
                    amount={money(split.amountMinorUnits)}
                    size="sm"
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  {split.occurredOn}
                  {split.categoryName !== null && ` · ${split.categoryName}`}
                  {split.expenseNote !== null && ` · ${split.expenseNote}`}
                </p>

                {/*
                  No destination, no form. An archived space, or one whose accounts are
                  all archived, has nowhere for the money to land — and a select with no
                  options plus a button that always fails is worse than not offering it.
                */}
                {accounts.length > 0 && (
                  <form action={formAction} className="flex items-end gap-2">
                    <input type="hidden" name="splitId" value={split.id} />
                    <div className="flex flex-1 flex-col gap-1">
                      <label
                        htmlFor={`settle-account-${split.id}`}
                        className="text-muted-foreground text-xs"
                      >
                        Entra en
                      </label>
                      <select
                        id={`settle-account-${split.id}`}
                        name="toAccountId"
                        required
                        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      >
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      aria-label={`Marcar cobrado a ${split.debtorName}`}
                    >
                      Ya me pagó
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {closed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs tracking-widest uppercase">
            Ya cobrado
          </h2>
          <ul className="divide-border flex flex-col divide-y">
            {closed.map((split) => (
              <li
                key={split.id}
                className="text-muted-foreground flex items-baseline justify-between gap-3 py-2 text-sm"
              >
                <span>
                  {split.debtorName}
                  <span className="ml-2 text-xs">{split.occurredOn}</span>
                </span>
                <MoneyDisplay
                  amount={money(split.amountMinorUnits)}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
