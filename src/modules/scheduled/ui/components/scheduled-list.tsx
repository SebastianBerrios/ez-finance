"use client";

import { useActionState } from "react";

import type { ScheduledSummary } from "@/modules/scheduled/application/ports/scheduled-port";
import { type Money, fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { Button } from "@shared/ui/button";
import { MoneyDisplay } from "@shared/ui/money-display";

export interface ToggleScheduledState {
  error?: string;
  paused?: string;
  resumed?: string;
}

type ToggleActionFn = (
  prev: ToggleScheduledState,
  formData: FormData,
) => Promise<ToggleScheduledState>;

interface ScheduledListProps {
  action: ToggleActionFn;
  schedules: readonly ScheduledSummary[];
  currency: string;
}

const initialState: ToggleScheduledState = {};

function money(currency: string, minorUnits: bigint): Money {
  const value = fromMinorUnits(currency, minorUnits);
  return value.ok ? value.value : expectOk(fromMinorUnits("PEN", 0n));
}

/**
 * The schedules, each with a way to pause it.
 *
 * MESSAGES RENDER BEFORE THE EMPTY STATE — the same lesson goals taught: pausing is not
 * removal so the list never empties here, but putting the confirmation behind an early
 * return is a trap that only shows itself at the boundary, and it costs nothing to
 * avoid.
 *
 * "Se aplicó hasta" is shown rather than "próximo": the watermark is what the system
 * actually knows. A predicted next date would be a second implementation of the
 * clamping arithmetic that already lives in the database, free to disagree with it every
 * February.
 */
export function ScheduledList({
  action,
  schedules,
  currency,
}: ScheduledListProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

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

      {state.paused !== undefined && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          Pausamos «{state.paused}». No se va a registrar hasta que lo reanudes.
        </p>
      )}

      {state.resumed !== undefined && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          «{state.resumed}» vuelve a estar activo. Los meses en pausa no se
          recuperan.
        </p>
      )}

      {schedules.length === 0 && (
        <p className="text-muted-foreground text-sm leading-relaxed">
          No tienes movimientos programados. Sirven para lo que se repite todos
          los meses — alquiler, sueldo, suscripciones — y se registran solos.
        </p>
      )}

      {schedules.map((schedule) => (
        <section
          key={schedule.id}
          className={
            schedule.paused
              ? "border-border/60 flex flex-col gap-2 rounded-xl border border-dashed p-4"
              : "bg-card border-border flex flex-col gap-2 rounded-xl border p-4"
          }
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground text-sm font-medium">
              {schedule.name}
              {schedule.paused && (
                <span className="text-muted-foreground ml-2 text-xs">
                  en pausa
                </span>
              )}
            </span>

            <form action={formAction}>
              <input type="hidden" name="scheduledId" value={schedule.id} />
              <input type="hidden" name="scheduledName" value={schedule.name} />
              <input
                type="hidden"
                name="intent"
                value={schedule.paused ? "resume" : "pause"}
              />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={isPending}
                aria-label={`${schedule.paused ? "Reanudar" : "Pausar"} ${schedule.name}`}
              >
                {schedule.paused ? "Reanudar" : "Pausar"}
              </Button>
            </form>
          </div>

          <p className="text-muted-foreground flex items-baseline justify-between text-sm">
            <span>
              Cada día {schedule.dayOfMonth} · {schedule.accountName}
              {schedule.categoryName !== null && ` · ${schedule.categoryName}`}
            </span>
            <MoneyDisplay
              amount={money(currency, schedule.amountMinorUnits)}
              size="sm"
              variant={schedule.kind === "income" ? "income" : "expense"}
            />
          </p>

          <p className="text-muted-foreground text-xs">
            {schedule.materialisedThrough === null
              ? "Todavía no se registró ninguna vez."
              : `Se aplicó hasta el ${schedule.materialisedThrough}.`}
          </p>
        </section>
      ))}
    </div>
  );
}
