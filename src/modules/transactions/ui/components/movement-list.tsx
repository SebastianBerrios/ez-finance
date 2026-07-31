"use client";

import { useActionState } from "react";

import type { Movement } from "@/modules/transactions/application/ports/transaction-port";
import { type Money, fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { MoneyDisplay } from "@shared/ui/money-display";

export interface MovementListState {
  error?: string;
}

type DeleteActionFn = (
  prev: MovementListState,
  formData: FormData,
) => Promise<MovementListState>;

interface MovementListProps {
  movements: readonly Movement[];
  deleteAction: DeleteActionFn;
  currency: string;
}

const initialState: MovementListState = {};

/**
 * How each kind reads. A transfer's direction matters more than the word
 * "transfer": what a person needs to know is whether money left or arrived.
 */
function describe(movement: Movement): {
  label: string;
  variant: "income" | "expense" | "transfer";
} {
  if (movement.kind === "income")
    return { label: "Ingreso", variant: "income" };
  if (movement.kind === "expense") {
    return {
      label: movement.categoryName ?? "Sin categoría",
      variant: "expense",
    };
  }
  return {
    label:
      movement.transferLeg === "in"
        ? "Transferencia recibida"
        : "Transferencia enviada",
    variant: "transfer",
  };
}

export function MovementList({
  movements,
  deleteAction,
  currency,
}: MovementListProps) {
  const [state, formAction, isPending] = useActionState(
    deleteAction,
    initialState,
  );

  if (movements.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Todavía no registraste movimientos este mes.
      </p>
    );
  }

  function money(minorUnits: bigint): Money {
    const result = fromMinorUnits(currency, minorUnits);
    return result.ok ? result.value : expectOk(fromMinorUnits("PEN", 0n));
  }

  return (
    <div className="flex flex-col gap-3">
      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      <ul className="divide-border flex flex-col divide-y">
        {movements.map((movement) => {
          const { label, variant } = describe(movement);

          return (
            <li
              key={movement.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-foreground truncate text-sm">
                  {label}
                </span>
                <span className="text-muted-foreground text-xs">
                  {movement.occurredOn} · {movement.accountName}
                  {movement.note !== null && ` · ${movement.note}`}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <MoneyDisplay
                  amount={money(movement.amountMinorUnits)}
                  size="sm"
                  variant={variant}
                />

                {/*
                  The delete control is rendered ONLY for the viewer's own
                  movements. Spec §4 scopes editing to "transacciones propias", and
                  a denied DELETE affects zero rows without raising — so a button
                  shown to everyone would appear to work and change nothing. Hiding
                  it is the honest version; the server still enforces it.
                */}
                {movement.isMine && (
                  <form action={formAction}>
                    <input
                      type="hidden"
                      name="transactionId"
                      value={movement.id}
                    />
                    <input
                      type="hidden"
                      name="transferId"
                      value={movement.transferId ?? ""}
                    />
                    <button
                      type="submit"
                      disabled={isPending}
                      aria-label={`Eliminar ${label} del ${movement.occurredOn}`}
                      className="text-muted-foreground hover:text-destructive rounded p-1 text-xs transition-colors disabled:opacity-50"
                    >
                      Eliminar
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/*
        Said once, under the list, rather than on every transfer row: deleting one
        leg is not possible, and someone about to press Eliminar on a transfer
        should know both sides go.
      */}
      {movements.some((movement) => movement.kind === "transfer") && (
        <p className="text-muted-foreground text-xs">
          Al eliminar una transferencia se borran sus dos lados.
        </p>
      )}
    </div>
  );
}
