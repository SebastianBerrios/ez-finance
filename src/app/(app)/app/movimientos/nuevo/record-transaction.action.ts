"use server";

import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { recordTransaction } from "@/modules/transactions/application/record-transaction";
import { SupabaseTransactionAdapter } from "@/modules/transactions/infrastructure/supabase-transaction-adapter";
import type { TransactionFormState } from "@/modules/transactions/ui/components/transaction-form";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

const MINOR_UNIT_EXPONENT = 2;

export async function recordTransactionAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const [entry, { user }] = await Promise.all([
    bootstrapUserWorkspace(),
    getAuthenticatedUser(),
  ]);

  if (!entry.ok || entry.value.kind !== "READY" || !user) {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const amount = parseAmountToMinorUnits(
    (formData.get("amount") as string | null) ?? "",
    MINOR_UNIT_EXPONENT,
  );

  if (!amount.ok) {
    return {
      error:
        amount.error.kind === "TooManyDecimals"
          ? "El monto puede tener como máximo dos decimales."
          : "Escribe el monto como un número, por ejemplo 25.50",
    };
  }

  const result = await recordTransaction(
    {
      workspaceId: entry.value.workspaceId,
      // RLS requires created_by = auth.uid(), so the author comes from the session
      // this write travels on rather than from anything the form could set.
      authorId: user.id,
      kind: (formData.get("kind") as string | null) ?? "",
      baseAmountMinorUnits: amount.value,
      occurredOn: (formData.get("occurredOn") as string | null) ?? "",
      accountId: (formData.get("accountId") as string | null) ?? "",
      categoryId: (formData.get("categoryId") as string | null) ?? "",
      note: (formData.get("note") as string | null) ?? "",
    },
    { transactions: new SupabaseTransactionAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidAmount":
        return { error: "El monto tiene que ser mayor que cero." };
      case "InvalidDate":
        return { error: "Elige una fecha válida." };
      case "InvalidKind":
        return { error: "Elige si es un gasto o un ingreso." };
      case "AccountRequired":
        return { error: "Elige la cuenta del movimiento." };
      case "NoteTooLong":
        return { error: "La nota puede tener hasta 500 caracteres." };
      case "UnknownReference":
        return { error: "Esa cuenta o categoría no es de este espacio." };
      case "NotPermitted":
        return {
          error: "No tienes permiso para registrar movimientos en este espacio.",
        };
      case "WorkspaceNotReady":
        return { error: "Primero crea una cuenta en tu espacio." };
      default:
        return { error: "No pudimos guardar el movimiento. Intenta de nuevo." };
    }
  }

  // Back to the dashboard, where the new movement has already changed the buckets.
  // The page is force-dynamic, so there is no cache to invalidate.
  redirect("/app");
}
