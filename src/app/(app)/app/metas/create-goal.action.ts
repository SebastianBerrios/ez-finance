"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { createGoal } from "@/modules/goals/application/create-goal";
import { SupabaseGoalAdapter } from "@/modules/goals/infrastructure/supabase-goal-adapter";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

export interface CreateGoalState {
  error?: string;
  created?: string;
}

const MINOR_UNIT_EXPONENT = 2;

export async function createGoalAction(
  _prev: CreateGoalState,
  formData: FormData,
): Promise<CreateGoalState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const amount = parseAmountToMinorUnits(
    (formData.get("target") as string | null) ?? "",
    MINOR_UNIT_EXPONENT,
  );

  if (!amount.ok) {
    return { error: "Escribe el monto como un número, por ejemplo 5000" };
  }

  const name = (formData.get("name") as string | null) ?? "";
  const targetDate = (
    (formData.get("targetDate") as string | null) ?? ""
  ).trim();

  const result = await createGoal(
    {
      workspaceId: entry.value.workspaceId,
      name,
      accountId: ((formData.get("accountId") as string | null) ?? "").trim(),
      targetAmountMinorUnits: amount.value,
      ...(targetDate.length === 0 ? {} : { targetDate }),
    },
    { goals: new SupabaseGoalAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NameRequired":
        return { error: "Escribe un nombre para la meta." };
      case "NameTooLong":
        return {
          error: "El nombre es demasiado largo (máximo 80 caracteres).",
        };
      case "TargetNotPositive":
        return { error: "El monto tiene que ser mayor que cero." };
      case "AccountRequired":
        return { error: "Elige la cuenta donde estás juntando." };
      case "InvalidDate":
        return { error: "Revisa la fecha." };
      case "AccountNotInWorkspace":
        return { error: "Esa cuenta no es de este espacio." };
      case "NotPermitted":
        return { error: "No tienes permiso para crear metas en este espacio." };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos crear la meta. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/metas");
  revalidatePath("/app");

  return { created: name.trim() };
}
