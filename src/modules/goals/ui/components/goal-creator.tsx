"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface CreateGoalState {
  error?: string;
  created?: string;
}

type CreateActionFn = (
  prev: CreateGoalState,
  formData: FormData,
) => Promise<CreateGoalState>;

/**
 * Declared here rather than imported from the accounts port: a form that consumed
 * AccountWithBalance would break whenever that port changed shape, for a reason having
 * nothing to do with goals. The page composes and adapts — the same arrangement the
 * movement form uses.
 */
export interface GoalAccountOption {
  readonly id: string;
  readonly name: string;
}

interface GoalCreatorProps {
  action: CreateActionFn;
  accounts: readonly GoalAccountOption[];
}

const initialState: CreateGoalState = {};

export function GoalCreator({ action, accounts }: GoalCreatorProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <details className="border-border rounded-lg border">
      <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
        Crear una meta
      </summary>

      <form
        action={formAction}
        noValidate
        className="flex flex-col gap-4 px-4 pt-2 pb-4"
      >
        {state.error !== undefined && (
          <div
            role="alert"
            aria-live="assertive"
            className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
          >
            {state.error}
          </div>
        )}

        {state.created !== undefined && (
          <p aria-live="polite" className="text-muted-foreground text-sm">
            Creamos «{state.created}».
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="goal-name">Nombre</Label>
          <Input
            id="goal-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="Viaje"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="goal-target">Monto (soles)</Label>
          <Input
            id="goal-target"
            name="target"
            type="text"
            inputMode="decimal"
            required
            placeholder="5000"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="goal-account">¿En qué cuenta estás juntando?</Label>
          <select
            id="goal-account"
            name="accountId"
            required
            defaultValue=""
            className="border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm"
          >
            <option value="" disabled>
              Elige una
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Solo cuentas de ahorro: el progreso es el saldo real de esa cuenta.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="goal-date">Fecha objetivo (opcional)</Label>
          <Input id="goal-date" name="targetDate" type="date" />
          <p className="text-muted-foreground text-xs">
            Sin fecha también sirve: una meta sin plazo es una dirección.
          </p>
        </div>

        <Button
          type="submit"
          variant="outline"
          disabled={isPending}
          className="w-full"
        >
          {isPending ? "Creando…" : "Crear"}
        </Button>
      </form>
    </details>
  );
}
