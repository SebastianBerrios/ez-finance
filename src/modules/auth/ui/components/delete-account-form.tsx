"use client";

import { useActionState, useState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface DeleteAccountFormState {
  error?: string;
}

type DeleteAccountActionFn = (
  prev: DeleteAccountFormState,
  formData: FormData,
) => Promise<DeleteAccountFormState>;

interface DeleteAccountFormProps {
  action: DeleteAccountActionFn;
}

const initialState: DeleteAccountFormState = {};

// Typed confirmation for a destructive, hard-to-discover-by-accident action.
// The same word is re-checked server-side: this guard is ergonomics, not security.
const CONFIRMATION_WORD = "ELIMINAR";

function isConfirmed(value: string): boolean {
  return value.trim().toUpperCase() === CONFIRMATION_WORD;
}

export function DeleteAccountForm({ action }: DeleteAccountFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [confirmation, setConfirmation] = useState("");

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {/* The consequences must be complete AT THE MOMENT OF CONFIRMATION.
          Since migration 20260725152507 a shared space whose last live member
          deletes their account is erased along with its history, so the old
          "los espacios compartidos siguen existiendo" was no longer true. */}
      <p className="text-muted-foreground text-sm">
        Tu cuenta queda programada para eliminarse en{" "}
        <strong className="text-foreground">30 días</strong>. Durante ese plazo
        puedes volver a ingresar y cancelar la eliminación. Al vencer, borramos
        tu perfil y tus espacios personales. Los espacios compartidos siguen
        existiendo mientras quede alguien más en ellos; si sos la{" "}
        <strong className="text-foreground">última persona</strong> de un
        espacio compartido, ese espacio y su historial también se borran.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="delete-account-confirm">
          Escribí {CONFIRMATION_WORD} para confirmar
        </Label>
        <Input
          id="delete-account-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={CONFIRMATION_WORD}
          disabled={isPending}
        />
      </div>

      <Button
        type="submit"
        variant="destructive"
        disabled={isPending || !isConfirmed(confirmation)}
        className="w-full"
      >
        {isPending ? "Procesando…" : "Eliminar mi cuenta"}
      </Button>
    </form>
  );
}
