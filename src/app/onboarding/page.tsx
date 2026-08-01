import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { SplitForm } from "@/modules/budget/ui/components/split-form";
import { readOnboardingStatus } from "@/modules/onboarding/infrastructure/onboarding-status";

import { saveSplitAction } from "./save-split.action";

export const metadata: Metadata = {
  title: "Configuración inicial — ez finance",
};

/** The method's namesake, and what the form starts at. */
const DEFAULT_SPLIT = { need: 50, want: 30, save: 20 } as const;

const BUCKETS: readonly { label: string; pct: number; what: string }[] = [
  {
    label: "Necesidades primarias",
    pct: DEFAULT_SPLIT.need,
    what: "lo que no puedes dejar de pagar",
  },
  {
    label: "Caprichos",
    pct: DEFAULT_SPLIT.want,
    what: "lo que eliges porque quieres",
  },
  {
    label: "Ahorro para el futuro",
    pct: DEFAULT_SPLIT.save,
    what: "lo que guardas o usas para salir de deudas",
  },
];

/**
 * Step 1 of the wizard: explain the method, then let the person set their split.
 *
 * The explanation earns its place because the product's central rule is
 * counter-intuitive — the percentages are measured against the month's INCOME, not
 * against total spending. Someone expecting "what share of my spending was needs?"
 * reads the dashboard as broken. Said once, up front, it costs a few lines.
 *
 * The split is asked HERE rather than at the end because it is the idea the product
 * is built on, and because it is the only answer that is already right by default:
 * the fields start at 50/30/20, so anyone who just wants to get going presses one
 * button. The income step, now last, is where these percentages turn into soles.
 */
export default async function OnboardingWelcomePage() {
  // Only the ROOT turns a configured workspace away. The sub-steps must stay
  // reachable even once a config exists, because THIS step writes one — see the
  // note in layout.tsx.
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const status = await readOnboardingStatus(entry.value.workspaceId);
  if (status.complete) {
    redirect("/app");
  }

  // Pre-fill from a split already chosen, so coming back shows what is stored
  // rather than resetting to the default. A read failure falls back to 50/30/20:
  // this step can always be answered again, and a default is never a wrong answer.
  const existing = await new SupabaseBudgetConfigAdapter().findForMonth(
    entry.value.workspaceId,
    new Date(),
  );
  const initial =
    existing.ok && existing.value !== null
      ? existing.value.percentages
      : DEFAULT_SPLIT;

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-muted-foreground text-sm">Paso 1 de 4</p>

      <h1 className="text-foreground mt-2 text-2xl font-semibold">
        Vamos a dejar tu presupuesto listo
      </h1>

      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        ez finance usa el método{" "}
        <strong className="text-foreground">50/30/20</strong>: tomas tu ingreso
        del mes y lo repartes en tres partes.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {BUCKETS.map((bucket) => (
          <li
            key={bucket.label}
            className="border-border flex items-baseline gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <span className="text-foreground w-12 shrink-0 font-semibold">
              {bucket.pct} %
            </span>
            <span className="flex flex-col">
              <span className="text-foreground">{bucket.label}</span>
              <span className="text-muted-foreground text-xs">
                {bucket.what}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="border-border bg-muted/30 mt-6 rounded-lg border p-4">
        <p className="text-foreground text-sm font-medium">
          Se mide sobre tu ingreso, no sobre tu gasto
        </p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          La pregunta que responde el panel es{" "}
          <em>«¿cuánto del 50 % para necesidades ya usé?»</em>, no «¿qué parte de
          mis gastos fue necesidad?». Por eso, si todavía no gastaste nada, tus
          tres cubos arrancan en 0 %.
        </p>
      </div>

      <p className="text-muted-foreground mt-6 mb-6 text-sm leading-relaxed">
        Estos son los porcentajes clásicos y ya están puestos. Si tu situación
        pide otro reparto, cámbialos — solo tienen que sumar 100. Se puede ajustar
        después.
      </p>

      <SplitForm
        action={saveSplitAction}
        initial={initial}
        submitLabel="Empezar"
      />
    </div>
  );
}
