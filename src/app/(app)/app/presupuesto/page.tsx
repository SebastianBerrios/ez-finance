import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
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
  const current = await resolveCurrentWorkspace();
  if (!current.ok || current.value.kind !== "READY") {
    redirect("/app");
  }

  const existing = await new SupabaseBudgetConfigAdapter().findForMonth(
    current.value.workspaceId,
    new Date(),
  );

  // THREE CASES, and they used to be one redirect.
  //
  // Unreadable: something is wrong. The wizard can rebuild a config from nothing, so
  // that is where an unreadable one goes.
  if (!existing.ok) {
    redirect("/onboarding");
  }

  // Missing on the PERSONAL space: the gate and the data disagree, same as before.
  if (existing.value === null && current.value.isPersonal) {
    redirect("/onboarding");
  }

  // Missing on a space you just created: not an error, just an unanswered question —
  // and THIS page is the place that answers it. Redirecting here would bounce off the
  // wizard root, which checks the personal workspace, finds it complete and sends you
  // back: an infinite loop. So the form opens on the method's own defaults and the
  // first save creates the row.
  const initial = existing.value ?? {
    percentages: { need: 50, want: 30, save: 20 },
    expectedIncomeMinorUnits: 0n,
    incomeMode: "mayor",
  };

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
        initial={initial}
      />
    </main>
  );
}
