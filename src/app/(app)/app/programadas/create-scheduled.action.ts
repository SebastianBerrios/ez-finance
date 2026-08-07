"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { createScheduled } from "@/modules/scheduled/application/create-scheduled";
import { SupabaseScheduledAdapter } from "@/modules/scheduled/infrastructure/supabase-scheduled-adapter";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

export interface CreateScheduledState {
  error?: string;
  created?: string;
}

const MINOR_UNIT_EXPONENT = 2;

export async function createScheduledAction(
  _prev: CreateScheduledState,
  formData: FormData,
): Promise<CreateScheduledState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const amount = parseAmountToMinorUnits(
    (formData.get("amount") as string | null) ?? "",
    MINOR_UNIT_EXPONENT,
  );

  if (!amount.ok) {
    return { error: "Escribe el monto como un número, por ejemplo 1500" };
  }

  const name = (formData.get("name") as string | null) ?? "";
  const category = ((formData.get("categoryId") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim();

  const result = await createScheduled(
    {
      workspaceId: entry.value.workspaceId,
      name,
      kind: (formData.get("kind") as string | null) ?? "",
      accountId: ((formData.get("accountId") as string | null) ?? "").trim(),
      amountMinorUnits: amount.value,
      dayOfMonth: Number.parseInt(
        (formData.get("dayOfMonth") as string | null) ?? "",
        10,
      ),
      ...(category.length === 0 ? {} : { categoryId: category }),
      ...(note.length === 0 ? {} : { note }),
    },
    { scheduled: new SupabaseScheduledAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "NameRequired":
        return { error: "Escribe un nombre para el movimiento." };
      case "NameTooLong":
        return {
          error: "El nombre es demasiado largo (máximo 80 caracteres).",
        };
      case "InvalidKind":
        return { error: "Elige si es un ingreso o un gasto." };
      case "AccountRequired":
        return { error: "Elige la cuenta." };
      case "AmountNotPositive":
        return { error: "El monto tiene que ser mayor que cero." };
      case "InvalidDay":
        return { error: "El día tiene que estar entre 1 y 31." };
      case "NoteTooLong":
        return { error: "La nota puede tener hasta 500 caracteres." };
      case "RefNotInWorkspace":
        return { error: "Esa cuenta o categoría no es de este espacio." };
      case "NotPermitted":
        return { error: "No tienes permiso para programar movimientos aquí." };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos programarlo. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/programadas");
  revalidatePath("/app");

  return { created: name.trim() };
}
