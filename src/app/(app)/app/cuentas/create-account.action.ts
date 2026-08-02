"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { createAccount } from "@/modules/accounts/application/create-account";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

export interface AccountFormState {
  error?: string;
  created?: string;
}

const MINOR_UNIT_EXPONENT = 2;

/**
 * Add an account from the management screen.
 *
 * The workspace's base currency is already fixed by this point — the first account,
 * created during setup, adopted it and it is immutable afterwards. So this does NOT
 * ask for a currency: every account here is created in the currency the workspace
 * already speaks, which is what the form shows as static text.
 *
 * revalidatePath('/app') as well as this route, because the dashboard lists balances
 * and the movement form lists accounts to record against.
 */
export async function createAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const rawBalance = (
    (formData.get("initialBalance") as string | null) ?? ""
  ).trim();

  // An empty opening balance means zero, not a mistake: most accounts someone adds
  // later are ones they are starting to track, not ones with a figure to hand.
  const balance =
    rawBalance.length === 0
      ? { ok: true as const, value: 0n }
      : parseAmountToMinorUnits(rawBalance, MINOR_UNIT_EXPONENT);

  if (!balance.ok) {
    return {
      error: "Escribe el saldo como un número, por ejemplo 1500.50",
    };
  }

  const name = (formData.get("name") as string | null) ?? "";

  const result = await createAccount(
    {
      workspaceId: entry.value.workspaceId,
      name,
      type: (formData.get("type") as string | null) ?? "",
      // Supplied, not taken from the form. By this point the workspace's base
      // currency is already fixed — the first account adopted it during setup and it
      // is immutable — so a currency field here could only ever disagree with it.
      // The app is soles-only, which is why the constant is safe rather than a read.
      currency: "PEN",
      initialBalanceMinorUnits: balance.value,
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
        return {
          error: "No tienes permiso para crear cuentas en este espacio.",
        };
      case "WorkspaceNotFound":
        return { error: "No encontramos tu espacio financiero." };
      default:
        return { error: "No pudimos crear la cuenta. Intenta de nuevo." };
    }
  }

  revalidatePath("/app/cuentas");
  revalidatePath("/app");

  return { created: name.trim() };
}
