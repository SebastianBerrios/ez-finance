import type { TransactionError } from "@/modules/transactions/domain/transaction-error";

/**
 * One sentence for a failed write, in the person's words.
 *
 * SHARED ON PURPOSE, by the two server actions and by the offline sync route. A queued
 * write is validated by the same use case as an online one, and it has to be REPORTED
 * the same way too — three copies of these strings is three chances for the offline path
 * to explain a refusal differently from the form the person was just looking at.
 *
 * The verb differs between recording and correcting, which is the whole reason for the
 * mode: "no tienes permiso para registrar" and "solo puedes editar lo que registraste"
 * are different facts, and collapsing them would make one of the two wrong.
 */
export function transactionErrorMessage(
  error: TransactionError,
  mode: "record" | "edit",
): string {
  switch (error.kind) {
    case "InvalidAmount":
      return "El monto tiene que ser mayor que cero.";
    case "InvalidDate":
      return "Elige una fecha válida.";
    case "InvalidKind":
      return "Elige si es un gasto o un ingreso.";
    case "AccountRequired":
      return "Elige la cuenta del movimiento.";
    case "NoteTooLong":
      return "La nota puede tener hasta 500 caracteres.";
    case "UnknownReference":
      return "Esa cuenta o categoría no es de este espacio.";
    case "TransferNotEditable":
      return "Una transferencia no se edita: elimínala y regístrala de nuevo.";
    case "NotPermitted":
      return mode === "record"
        ? "No tienes permiso para registrar movimientos en este espacio."
        : "Solo puedes editar los movimientos que registraste.";
    case "WorkspaceNotReady":
      return "Primero crea una cuenta en tu espacio.";
    default:
      return mode === "record"
        ? "No pudimos guardar el movimiento. Intenta de nuevo."
        : "No pudimos guardar el cambio. Intenta de nuevo.";
  }
}
