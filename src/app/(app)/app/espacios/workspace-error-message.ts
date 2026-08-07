// workspace-error-message.ts — one WorkspaceError, one sentence.
//
// NOT a "use server" module, and that is the reason it is a separate file rather
// than a helper inside one of the actions: every export of a "use server" module
// has to be an async server function, so a plain synchronous mapper cannot live
// there. Next fails the build rather than warning.
//
// Shared by the four actions in this folder because they call different use cases
// and surface the SAME union. Four copies of a switch over it is four chances for
// one of them to answer "no pudimos" to a refusal the person could have acted on.
// Imported from the PORT, not from the module's domain. eslint-plugin-boundaries
// forbids the app layer reaching into a module's domain, and it is right to: the
// delivery layer consumes a module through its application surface, which
// re-exports this union precisely so callers do not have to.
import type { WorkspaceError } from "@/modules/workspaces/application/ports/workspace-port";

export function workspaceErrorMessage(error: WorkspaceError): string {
  switch (error.kind) {
    case "NameRequired":
      return "Escribe un nombre para el espacio.";
    case "NameTooLong":
      return "El nombre puede tener hasta 80 caracteres.";
    case "LimitReached":
      return "Llegaste al máximo de espacios. Archiva o elimina uno para crear otro.";
    case "Archived":
      return "Este espacio está en solo lectura. Restáuralo para poder cambiarlo.";
    case "AlreadyArchived":
      return "Este espacio ya estaba archivado. Actualiza la página.";
    case "NotArchived":
      return "Primero archiva el espacio; recién entonces se puede eliminar.";
    case "PersonalWorkspace":
      return "Tu espacio personal no se archiva ni se elimina: es el punto de partida de la app.";
    case "NameMismatch":
      return "Ese nombre no coincide con el del espacio. Escríbelo exactamente igual.";
    case "NotPermitted":
      return "No tienes permiso para hacer esto en este espacio.";
    default:
      return "No pudimos completar la acción. Intenta de nuevo en unos minutos.";
  }
}
