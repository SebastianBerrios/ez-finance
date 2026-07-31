"use server";

import { redirect } from "next/navigation";

import { createAccount } from "@/modules/accounts/application/create-account";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import type { AccountFormState } from "@/modules/accounts/ui/components/account-form";
import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

/** Every currency the app offers has two decimals; PEN included. */
const MINOR_UNIT_EXPONENT = 2;

export async function createAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const amount = parseAmountToMinorUnits(
    (formData.get("initialBalance") as string | null) ?? "",
    MINOR_UNIT_EXPONENT,
  );

  if (!amount.ok) {
    return {
      error:
        amount.error.kind === "TooManyDecimals"
          ? "El saldo puede tener como máximo dos decimales."
          : "Escribe el saldo como un número, por ejemplo 1500.50",
    };
  }

  const result = await createAccount(
    {
      workspaceId: entry.value.workspaceId,
      name: (formData.get("name") as string | null) ?? "",
      type: (formData.get("type") as string | null) ?? "",
      // The workspace has no base currency until this very account creates it, so
      // the value is supplied rather than read back from anywhere.
      currency: "PEN",
      initialBalanceMinorUnits: amount.value,
    },
    { accounts: new SupabaseAccountAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidAccountName":
        return { error: "Escribe un nombre de hasta 80 caracteres." };
      case "InvalidAccountType":
        return { error: "Elige uno de los tipos de la lista." };
      case "UnsupportedCurrency":
        return { error: "Esa moneda no está disponible." };
      case "NotPermitted":
        return { error: "No tienes permiso para crear cuentas en este espacio." };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos guardar la cuenta. Intenta de nuevo." };
    }
  }

  // redirect() throws, so it MUST be outside the try/catch-shaped code above and
  // after the last thing that can fail — Next.js signals navigation by throwing.
  redirect("/onboarding/categorias");
}
