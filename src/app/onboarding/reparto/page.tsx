import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { SplitForm } from "@/modules/budget/ui/components/split-form";

import { saveSplitAction } from "./save-split.action";

export const metadata: Metadata = {
  title: "Tu reparto — ez finance",
};

const DEFAULT_SPLIT = { need: 50, want: 30, save: 20 };

export default async function OnboardingSplitPage() {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const existing = await new SupabaseBudgetConfigAdapter().findForMonth(
    entry.value.workspaceId,
    new Date(),
  );

  // No config means the income step has not run, and this step edits what that one
  // wrote — sending them back is the only honest option.
  if (existing.ok && existing.value === null) {
    redirect("/onboarding/ingreso");
  }

  // Prefilled from what is stored, so returning to this step shows the current
  // split rather than resetting it to the default.
  const initial =
    existing.ok && existing.value !== null
      ? existing.value.percentages
      : DEFAULT_SPLIT;

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-muted-foreground text-sm">Paso 5 de 5</p>

      <h1 className="text-foreground mt-2 text-2xl font-semibold">
        ¿Cómo reparto tu ingreso?
      </h1>

      <p className="text-muted-foreground mt-2 mb-6 text-sm leading-relaxed">
        El 50/30/20 es el punto de partida, no una regla. Ajústalo a tu realidad —
        lo único que pedimos es que sume 100 %.
      </p>

      <SplitForm action={saveSplitAction} initial={initial} />
    </div>
  );
}
