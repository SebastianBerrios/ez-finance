"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { setCategoryLimit } from "@/modules/budget/application/set-category-limit";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import type { CategoryLimitState } from "@/modules/budget/ui/components/category-limits";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

const MINOR_UNIT_EXPONENT = 2;

/**
 * Save or clear one category's ceiling.
 *
 * AN EMPTY FIELD CLEARS, and it is checked before parsing: "" is not a number and
 * running it through parseAmountToMinorUnits would answer NotANumber, turning the most
 * ordinary intent on this screen — erase the number — into an error message.
 */
export async function setCategoryLimitAction(
  _prev: CategoryLimitState,
  formData: FormData,
): Promise<CategoryLimitState> {
  const entry = await resolveCurrentWorkspace();

  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const categoryId = (formData.get("categoryId") as string | null) ?? "";
  const categoryName = (formData.get("categoryName") as string | null) ?? "";
  const raw = ((formData.get("limit") as string | null) ?? "").trim();

  let limitMinorUnits: bigint | null = null;

  if (raw.length > 0) {
    const parsed = parseAmountToMinorUnits(raw, MINOR_UNIT_EXPONENT);

    if (!parsed.ok) {
      return {
        error:
          parsed.error.kind === "TooManyDecimals"
            ? "El límite puede tener como máximo dos decimales."
            : "Escribe el límite como un número, por ejemplo 400.00",
      };
    }

    // Caught here rather than only in the use case so the message can name the reason
    // instead of the generic invalid-config one the domain answers with.
    if (parsed.value <= 0n) {
      return {
        error:
          "Un límite de cero no es un límite. Deja el campo vacío para quitarlo.",
      };
    }

    limitMinorUnits = parsed.value;
  }

  const result = await setCategoryLimit(
    {
      workspaceId: entry.value.workspaceId,
      // The CURRENT month's config, the same one this screen edits. A limit belongs to
      // a config version, so a ceiling set today governs this month onward and leaves
      // the months already lived exactly as they were.
      month: new Date(),
      categoryId,
      limitMinorUnits,
    },
    { budget: new SupabaseBudgetConfigAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NotConfigured":
        return {
          error:
            "Primero define tu presupuesto del mes; el límite se guarda junto con él.",
        };
      case "NotPermitted":
        return { error: "No tienes permiso para cambiar el presupuesto aquí." };
      case "InvalidConfig":
        return { error: "Ese límite no es válido." };
      case "WorkspaceNotFound":
        return { error: "No pudimos identificar tu espacio." };
      default:
        return { error: "No pudimos guardar el límite. Intenta de nuevo." };
    }
  }

  // The dashboard's alerts are computed from these, so its cached render is stale in a
  // way the person will look for immediately.
  revalidatePath("/app");
  revalidatePath("/app/presupuesto");

  return limitMinorUnits === null
    ? { cleared: categoryName }
    : { saved: categoryName };
}
