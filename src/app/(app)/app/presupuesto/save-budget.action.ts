"use server";

import { revalidatePath } from "next/cache";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { saveBudgetConfig } from "@/modules/budget/application/save-budget-config";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

export interface BudgetFormState {
  error?: string;
  saved?: boolean;
}

const MINOR_UNIT_EXPONENT = 2;

function toPercentage(raw: FormDataEntryValue | null): number {
  // NaN when absent or malformed, which validateConfig rejects as non-integer.
  // Never defaulted to 0: a missing field is a broken submission, and a silent 0
  // would let a wrong split through whenever it happened to still sum to 100.
  return Number.parseInt((raw as string | null) ?? "", 10);
}

/**
 * Change this month's budget: the split, the expected income, and the income mode.
 *
 * ONE ACTION FOR ALL THREE, because budget_configs has no valid partial state — the
 * percentages are NOT NULL and must sum to 100 — so any write is a whole row anyway.
 * Splitting it into three actions would have meant three read-modify-writes racing
 * each other over the same row.
 *
 * WHAT "THIS MONTH" MEANS, and it is the load-bearing part. budget_configs is
 * TEMPORAL: one row per change, keyed by a month boundary, and the config in force
 * for month M is the greatest row at or before M. Saving here therefore rewrites the
 * CURRENT month's row and every later month that inherits it — and leaves earlier
 * months exactly as they were lived. That is the whole reason the table is shaped
 * this way: raising your expected income in June must not re-scale March.
 */
export async function saveBudgetAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
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
      percentages: {
        need: toPercentage(formData.get("need")),
        want: toPercentage(formData.get("want")),
        save: toPercentage(formData.get("save")),
      },
    },
    { budget: new SupabaseBudgetConfigAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidConfig":
        return {
          error:
            "Revisa los datos: los porcentajes tienen que ser enteros y sumar 100.",
        };
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

  revalidatePath("/app/presupuesto");
  revalidatePath("/app");

  return { saved: true };
}
