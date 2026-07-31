"use server";

import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { saveBudgetConfig } from "@/modules/budget/application/save-budget-config";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

export interface IncomeFormState {
  error?: string;
}

const MINOR_UNIT_EXPONENT = 2;

/**
 * Store the month's expected income, together with the 50/30/20 default split.
 *
 * It writes a COMPLETE config rather than half of one, because budget_configs has
 * no valid half-state: the percentages are NOT NULL and must sum to 100. So this
 * step commits a usable budget, and the next step refines the split. The
 * consequence is that the workspace counts as configured from here on, which is
 * exactly why the "already configured" redirect lives on the wizard root and not
 * in its layout.
 */
export async function saveIncomeAction(
  _prev: IncomeFormState,
  formData: FormData,
): Promise<IncomeFormState> {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const amount = parseAmountToMinorUnits(
    (formData.get("expectedIncome") as string | null) ?? "",
    MINOR_UNIT_EXPONENT,
  );

  if (!amount.ok) {
    return {
      error:
        amount.error.kind === "TooManyDecimals"
          ? "El ingreso puede tener como máximo dos decimales."
          : "Escribe el ingreso como un número, por ejemplo 3500",
    };
  }

  if (amount.value < 0n) {
    return { error: "El ingreso no puede ser negativo." };
  }

  const result = await saveBudgetConfig(
    {
      workspaceId: entry.value.workspaceId,
      month: new Date(),
      incomeMode: (formData.get("incomeMode") as string | null) ?? "mayor",
      expectedIncomeMinorUnits: amount.value,
      // The default split. The next step is where it stops being a default.
      percentages: { need: 50, want: 30, save: 20 },
    },
    { budget: new SupabaseBudgetConfigAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidConfig":
        return { error: "Revisa el ingreso y el modo elegido." };
      case "NotPermitted":
        return {
          error: "No tienes permiso para editar el presupuesto de este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos guardar tu presupuesto. Intenta de nuevo." };
    }
  }

  redirect("/onboarding/reparto");
}
