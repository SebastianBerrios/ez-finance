import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { IncomeForm } from "@/modules/budget/ui/components/income-form";

import { saveIncomeAction } from "./save-income.action";

export const metadata: Metadata = {
  title: "Tu ingreso — ez finance",
};

/** What step 1 pre-fills, and the fallback if its config cannot be read. */
const DEFAULT_SPLIT = { need: 50, want: 30, save: 20 } as const;

/**
 * The wizard's LAST step: the income, and what the chosen split does to it.
 *
 * The percentages are read here rather than carried through steps 2 and 3, so
 * there is no hidden field to keep in sync and no state in the URL — the same
 * reason the old standalone split step read the income back instead of receiving
 * it.
 */
export default async function OnboardingIncomePage() {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const existing = await new SupabaseBudgetConfigAdapter().findForMonth(
    entry.value.workspaceId,
    new Date(),
  );
  const percentages =
    existing.ok && existing.value !== null
      ? existing.value.percentages
      : DEFAULT_SPLIT;

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-muted-foreground text-sm">Paso 4 de 4</p>

      <h1 className="text-foreground mt-2 text-2xl font-semibold">
        ¿Cuánto esperas recibir este mes?
      </h1>

      <p className="text-muted-foreground mt-2 mb-6 text-sm leading-relaxed">
        Con esto ya podemos repartir tu mes en los tres cubos que elegiste.
      </p>

      <IncomeForm
        action={saveIncomeAction}
        currencyLabel="soles"
        percentages={percentages}
        submitLabel="Terminar"
      />
    </div>
  );
}
