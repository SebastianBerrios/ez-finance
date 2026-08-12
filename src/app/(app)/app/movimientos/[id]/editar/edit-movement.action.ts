"use server";

import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { editMovement } from "@/modules/transactions/application/edit-movement";
import { SupabaseTransactionAdapter } from "@/modules/transactions/infrastructure/supabase-transaction-adapter";
import type { TransactionFormState } from "@/modules/transactions/ui/components/transaction-form";
import { transactionErrorMessage } from "@/modules/transactions/ui/transaction-error-message";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

const MINOR_UNIT_EXPONENT = 2;

/**
 * Save a correction to an existing movement.
 *
 * The id travels in a HIDDEN FIELD rather than being bound from the route, and it is
 * checked against the workspace the session resolves to rather than trusted — the
 * same reason recordTransactionAction takes the author from the session and not from
 * the form. Even so, nothing here is the real guard: the UPDATE policy scopes the
 * statement to rows the caller authored, and a mismatch simply matches no row, which
 * the use case reports as NotPermitted.
 */
export async function editMovementAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const entry = await resolveCurrentWorkspace();

  if (!entry.ok || entry.value.kind !== "READY") {
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

  const transferId = (formData.get("transferId") as string | null) ?? "";

  const result = await editMovement(
    {
      workspaceId: entry.value.workspaceId,
      transactionId: (formData.get("transactionId") as string | null) ?? "",
      transferId: transferId.length === 0 ? null : transferId,
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
    return { error: transactionErrorMessage(result.error, "edit") };
  }

  // Back to the dashboard, where the corrected figure has already moved the buckets.
  redirect("/app");
}
