"use server";

import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { recordSplitExpense } from "@/modules/splits/application/record-split-expense";
import { SupabaseSplitAdapter } from "@/modules/splits/infrastructure/supabase-split-adapter";
import type { SplitFormState } from "@/modules/splits/ui/components/split-form";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

const MINOR_UNIT_EXPONENT = 2;

/**
 * The form submits the debtors as two PARALLEL repeated fields — one `debtorName` and
 * one `debtorAmount` per row — so they are zipped back together by position here.
 *
 * getAll preserves document order, which is the order the rows were rendered in, so
 * index i of one list belongs to index i of the other. A mismatch in length can only
 * come from a tampered payload, and it is refused rather than zipped short: dropping the
 * extra rows would silently record fewer debtors than the person typed.
 */
function readDebtors(formData: FormData):
  | { ok: true; value: { name: string; amountMinorUnits: bigint }[] }
  | {
      ok: false;
      error: string;
    } {
  const names = formData.getAll("debtorName").map(String);
  const amounts = formData.getAll("debtorAmount").map(String);

  if (names.length !== amounts.length) {
    return { ok: false, error: "No pudimos leer la lista de personas." };
  }

  const debtors: { name: string; amountMinorUnits: bigint }[] = [];

  for (const [index, name] of names.entries()) {
    const raw = amounts[index] ?? "";
    const amount = parseAmountToMinorUnits(raw, MINOR_UNIT_EXPONENT);

    if (!amount.ok) {
      return {
        ok: false,
        error: `Revisa cuánto te debe ${name.trim().length === 0 ? "esa persona" : name.trim()}: escribe un número como 25.50`,
      };
    }

    debtors.push({ name, amountMinorUnits: amount.value });
  }

  return { ok: true, value: debtors };
}

export async function recordSplitExpenseAction(
  _prev: SplitFormState,
  formData: FormData,
): Promise<SplitFormState> {
  const entry = await resolveCurrentWorkspace();

  if (!entry.ok || entry.value.kind !== "READY") {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  // ZERO IS ALLOWED here, unlike an ordinary expense: paying for someone else's dinner
  // in full is a real thing, and refusing it would force recording a fake share.
  const myShare = parseAmountToMinorUnits(
    (formData.get("myShare") as string | null) ?? "",
    MINOR_UNIT_EXPONENT,
  );

  if (!myShare.ok) {
    return {
      error:
        myShare.error.kind === "TooManyDecimals"
          ? "Tu parte puede tener como máximo dos decimales."
          : "Escribe tu parte como un número, por ejemplo 25.50",
    };
  }

  const debtors = readDebtors(formData);
  if (!debtors.ok) return { error: debtors.error };

  const result = await recordSplitExpense(
    {
      workspaceId: entry.value.workspaceId,
      myShareMinorUnits: myShare.value,
      accountId: (formData.get("accountId") as string | null) ?? "",
      categoryId: (formData.get("categoryId") as string | null) ?? "",
      occurredOn: (formData.get("occurredOn") as string | null) ?? "",
      note: (formData.get("note") as string | null) ?? "",
      debtors: debtors.value,
    },
    { splits: new SupabaseSplitAdapter() },
  );

  if (!result.ok) {
    switch (result.error.kind) {
      case "InvalidShare":
        return { error: "Tu parte no puede ser negativa." };
      case "AccountRequired":
        return { error: "Elige la cuenta que pagó." };
      case "InvalidDate":
        return { error: "Elige una fecha válida." };
      case "DebtorsRequired":
        return {
          error:
            "Agrega al menos una persona que te deba. Si nadie te debe, registralo como un gasto normal.",
        };
      case "TooManyDebtors":
        return { error: "Puedes dividir un gasto con hasta 20 personas." };
      case "DebtorNameRequired":
        return { error: "Escribe el nombre de cada persona." };
      case "DebtorNameTooLong":
        return { error: "Cada nombre puede tener hasta 80 caracteres." };
      case "InvalidDebtorAmount":
        return {
          error: "Lo que te debe cada persona tiene que ser mayor que cero.",
        };
      case "UnknownReference":
        return { error: "Esa cuenta o categoría no es de este espacio." };
      case "NotPermitted":
        return {
          error:
            "No tienes permiso para registrar movimientos en este espacio.",
        };
      case "WorkspaceNotReady":
        return { error: "Primero crea una cuenta en tu espacio." };
      default:
        return { error: "No pudimos guardar el gasto. Intenta de nuevo." };
    }
  }

  // To the debts screen, not the dashboard: what someone wants to see right after
  // splitting an expense is the list of who now owes them.
  redirect("/app/deudas");
}
