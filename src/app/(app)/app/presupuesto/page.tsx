import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { BudgetForm } from "@/modules/budget/ui/components/budget-form";

import { saveBudgetAction } from "./save-budget.action";

export const metadata: Metadata = {
  title: "Presupuesto — ez finance",
};

/**
 * Change the budget: the split, the expected income, and which income the engine
 * measures against.
 *
 * WHY THIS PAGE EXISTS. All three were settable exactly once, during a wizard that
 * cannot be re-entered — and the income mode was not settable at all after being
 * dropped from setup, which was the right call for setup and left no home for it.
 *
 * WHAT SAVING DOES TO HISTORY, which is the thing worth understanding before
 * touching anything here: budget_configs is temporal, one row per change keyed by a
 * month boundary. Saving rewrites the row governing the CURRENT month, and every
 * later month that inherits from it — and leaves earlier months exactly as they were
 * lived. Raising your expected income today does not re-scale March.
 */
export default async function BudgetPage() {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const existing = await new SupabaseBudgetConfigAdapter().findForMonth(
    entry.value.workspaceId,
    new Date(),
  );

  // No config and an unreadable config are different things. The first cannot happen
  // on this page — the (app) gate requires a configured workspace to get here — so
  // reaching either case means something is wrong rather than unfinished, and the
  // wizard is the only place that can rebuild it.
  if (!existing.ok || existing.value === null) {
    redirect("/onboarding");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-bold">Presupuesto</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Cambia tu ingreso del mes y cómo se reparte. Los meses que ya pasaron
          se quedan como los viviste.
        </p>
      </div>

      <BudgetForm
        action={saveBudgetAction}
        currencyLabel="soles"
        initial={{
          percentages: existing.value.percentages,
          expectedIncomeMinorUnits: existing.value.expectedIncomeMinorUnits,
          incomeMode: existing.value.incomeMode,
        }}
      />
    </main>
  );
}
