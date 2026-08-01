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
 * Store the month's expected income, keeping the split chosen at step 1.
 *
 * LAST step of the wizard, so it lands on /app: from here the workspace has an
 * account and a config with a real income, and the (app) gate lets it through.
 *
 * The percentages are read back rather than received as hidden fields. Defaulting
 * them here instead would be the bug this ordering invites: step 1 already stored
 * the person's split, and writing 50/30/20 over it would silently discard the one
 * answer they were asked to think about.
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

  const budget = new SupabaseBudgetConfigAdapter();

  // Step 1 wrote the split. If it cannot be read we fall back to 50/30/20 rather
  // than refusing: an unreadable config would otherwise trap someone one step from
  // the end, and the method's own defaults are never a wrong answer.
  const existing = await budget.findForMonth(
    entry.value.workspaceId,
    new Date(),
  );
  const percentages =
    existing.ok && existing.value !== null
      ? existing.value.percentages
      : { need: 50, want: 30, save: 20 };

  const result = await saveBudgetConfig(
    {
      workspaceId: entry.value.workspaceId,
      month: new Date(),
      // Fixed, not read from the form: the wizard no longer asks. `mayor` is
      // max(received, expected), which is what someone who states a salary and
      // records extra earnings later actually wants — the buckets grow when the
      // extra money arrives and never fall below the salary. See the note in
      // income-form.tsx for why the question is gone.
      incomeMode: "mayor",
      expectedIncomeMinorUnits: amount.value,
      percentages,
    },
    { budget },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidConfig":
        return { error: "Revisa el monto del ingreso." };
      case "NotPermitted":
        return {
          error:
            "No tienes permiso para editar el presupuesto de este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return {
          error: "No pudimos guardar tu presupuesto. Intenta de nuevo.",
        };
    }
  }

  redirect("/app");
}
