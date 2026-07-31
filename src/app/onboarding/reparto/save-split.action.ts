"use server";

import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { saveBudgetConfig } from "@/modules/budget/application/save-budget-config";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";

export interface SplitFormState {
  error?: string;
}

function toPercentage(raw: FormDataEntryValue | null): number {
  // NaN when absent or malformed, which validateConfig then rejects as
  // non-integer. Deliberately not defaulted to 0: a missing field is a broken
  // submission, and silently sending 0 would let a wrong split through whenever
  // it happened to still sum to 100.
  return Number.parseInt((raw as string | null) ?? "", 10);
}

/**
 * Store the person's own split, replacing the 50/30/20 the income step wrote.
 *
 * Last step of the wizard, so it lands on /app: from here the workspace has both
 * an account and a config, and the (app) gate lets it through.
 */
export async function saveSplitAction(
  _prev: SplitFormState,
  formData: FormData,
): Promise<SplitFormState> {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const budget = new SupabaseBudgetConfigAdapter();

  // The income and the mode were chosen in the previous step; this step must not
  // overwrite them with a default. Reading them back is what keeps the two steps
  // independent — no hidden fields to keep in sync, no state carried in the URL.
  const existing = await budget.findForMonth(entry.value.workspaceId, new Date());
  if (!existing.ok) {
    return { error: "No pudimos leer tu presupuesto. Intenta de nuevo." };
  }
  if (existing.value === null) {
    // Nothing to refine — the income step never completed.
    redirect("/onboarding/ingreso");
  }

  const result = await saveBudgetConfig(
    {
      workspaceId: entry.value.workspaceId,
      month: new Date(),
      incomeMode: existing.value.incomeMode,
      expectedIncomeMinorUnits: existing.value.expectedIncomeMinorUnits,
      percentages: {
        need: toPercentage(formData.get("need")),
        want: toPercentage(formData.get("want")),
        save: toPercentage(formData.get("save")),
      },
    },
    { budget },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidConfig":
        return {
          error: "Los porcentajes tienen que ser enteros y sumar 100.",
        };
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar el presupuesto de este espacio.",
        };
      default:
        return { error: "No pudimos guardar el reparto. Intenta de nuevo." };
    }
  }

  redirect("/app");
}
