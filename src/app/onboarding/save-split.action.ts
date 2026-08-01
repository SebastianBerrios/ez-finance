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
 * Step 1 of the wizard: store how the month's income gets divided.
 *
 * WHY THIS RUNS FIRST. The split IS the product's idea, so asking it last hid the
 * one thing a new person needs to understand. It is also the only step whose
 * answer is already correct by default — 50/30/20 is pre-filled, so the fast path
 * is a single click.
 *
 * WHAT IT COSTS, AND HOW THAT IS PAID FOR. budget_configs has no valid half-state:
 * the percentages are NOT NULL and must sum to 100, so this writes a whole row,
 * with expected_income left at its `0` default until the income step. That row
 * would otherwise read as "this workspace is configured" the moment an account
 * exists, and drop someone into a dashboard dividing by zero income. So
 * readOnboardingStatus requires an income ABOVE zero, not merely a config row —
 * see the note on OnboardingStatus.hasBudgetConfig.
 *
 * An existing income is never clobbered. Re-running the wizard, or coming back to
 * change the split next month, must not silently reset what was already earned.
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

  // Read before write, so an income already chosen survives a change of split.
  // A read FAILURE is not fatal here: it only means we cannot preserve an income
  // that may not exist yet, and the income step is still ahead.
  const existing = await budget.findForMonth(entry.value.workspaceId, new Date());
  const carried =
    existing.ok && existing.value !== null
      ? {
          incomeMode: existing.value.incomeMode,
          expectedIncomeMinorUnits: existing.value.expectedIncomeMinorUnits,
        }
      : { incomeMode: "mayor", expectedIncomeMinorUnits: 0n };

  const result = await saveBudgetConfig(
    {
      workspaceId: entry.value.workspaceId,
      month: new Date(),
      incomeMode: carried.incomeMode,
      expectedIncomeMinorUnits: carried.expectedIncomeMinorUnits,
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
        return { error: "Los porcentajes tienen que ser enteros y sumar 100." };
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar el presupuesto de este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos guardar el reparto. Intenta de nuevo." };
    }
  }

  redirect("/onboarding/cuenta");
}
