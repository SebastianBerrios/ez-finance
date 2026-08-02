"use client";

import { useActionState } from "react";

import type { GoalProgress } from "@/modules/goals/application/ports/goal-port";
import { type Money, fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { Button } from "@shared/ui/button";
import { MoneyDisplay } from "@shared/ui/money-display";

export interface ArchiveGoalState {
  error?: string;
  archived?: string;
}

type ArchiveActionFn = (
  prev: ArchiveGoalState,
  formData: FormData,
) => Promise<ArchiveGoalState>;

interface GoalListProps {
  action: ArchiveActionFn;
  goals: readonly GoalProgress[];
  currency: string;
}

const initialState: ArchiveGoalState = {};

function money(currency: string, minorUnits: bigint): Money {
  const value = fromMinorUnits(currency, minorUnits);
  return value.ok ? value.value : expectOk(fromMinorUnits("PEN", 0n));
}

/**
 * Percent of the target saved, floored, clamped to 0–100 FOR THE BAR ONLY.
 *
 * The bar is clamped because a progress bar past its end is a rendering bug; the
 * FIGURES beside it are not, so saving more than the target still reads honestly as
 * more than the target. A negative balance shows an empty bar rather than an inverted
 * one, with the real amount next to it.
 */
function percent(saved: bigint, target: bigint): number {
  if (target <= 0n) return 0;
  const raw = Number((saved * 100n) / target);
  return Math.max(0, Math.min(100, raw));
}

export function GoalList({ action, goals, currency }: GoalListProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (goals.length === 0) {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed">
        Todavía no tienes metas. Una meta es un monto al que quieres llegar en
        una cuenta de ahorro — el progreso sale del saldo real de esa cuenta, no
        de un número aparte.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {state.archived !== undefined && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          Archivamos «{state.archived}». El dinero sigue en su cuenta.
        </p>
      )}

      {goals.map((goal) => {
        const pct = percent(goal.savedMinorUnits, goal.targetMinorUnits);
        const reached = goal.savedMinorUnits >= goal.targetMinorUnits;

        return (
          <section
            key={goal.id}
            className="bg-card border-border flex flex-col gap-2 rounded-xl border p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-foreground text-sm font-medium">
                {goal.name}
                {reached && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    ¡llegaste!
                  </span>
                )}
              </span>
              <form action={formAction}>
                <input type="hidden" name="goalId" value={goal.id} />
                <input type="hidden" name="goalName" value={goal.name} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  aria-label={`Archivar meta ${goal.name}`}
                >
                  Archivar
                </Button>
              </form>
            </div>

            <p className="text-muted-foreground text-xs">
              En {goal.accountName}
              {goal.targetDate !== null && ` · para el ${goal.targetDate}`}
            </p>

            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progreso de ${goal.name}`}
              className="bg-muted h-2 w-full overflow-hidden rounded-full"
            >
              <div
                className={
                  reached ? "bg-primary h-full" : "bg-foreground/60 h-full"
                }
                style={{ width: `${pct}%` }}
              />
            </div>

            <p className="text-muted-foreground flex items-baseline justify-between text-sm">
              <span>
                <MoneyDisplay
                  amount={money(currency, goal.savedMinorUnits)}
                  size="sm"
                />{" "}
                de{" "}
                <MoneyDisplay
                  amount={money(currency, goal.targetMinorUnits)}
                  size="sm"
                />
              </span>
              <span className="text-xs">{pct}%</span>
            </p>
          </section>
        );
      })}
    </div>
  );
}
