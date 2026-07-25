"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Label } from "@shared/ui/label";

export interface PreferencesFormState {
  success?: boolean;
  error?: string;
}

type PreferencesActionFn = (
  prev: PreferencesFormState,
  formData: FormData,
) => Promise<PreferencesFormState>;

interface PreferencesFormProps {
  action: PreferencesActionFn;
  initialLanguage?: "es" | "en";
  initialCurrency?: string;
}

const initialState: PreferencesFormState = {};

// ISO 4217 common currencies — extend as needed.
const CURRENCIES = [
  { code: "ARS", label: "ARS — Peso argentino" },
  { code: "USD", label: "USD — Dólar estadounidense" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "MXN", label: "MXN — Peso mexicano" },
  { code: "CLP", label: "CLP — Peso chileno" },
  { code: "COP", label: "COP — Peso colombiano" },
  { code: "BRL", label: "BRL — Real brasileño" },
  { code: "PEN", label: "PEN — Sol peruano" },
  { code: "UYU", label: "UYU — Peso uruguayo" },
  { code: "PYG", label: "PYG — Guaraní paraguayo" },
  { code: "GBP", label: "GBP — Libra esterlina" },
];

export function PreferencesForm({
  action,
  initialLanguage = "es",
  initialCurrency = "ARS",
}: PreferencesFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.success && (
        <div
          role="status"
          aria-live="polite"
          className="bg-muted rounded-lg px-4 py-3 text-sm"
        >
          Preferencias guardadas correctamente.
        </div>
      )}

      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="pref-language">Idioma</Label>
        <select
          id="pref-language"
          name="language"
          defaultValue={initialLanguage}
          disabled={isPending}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pref-currency">Moneda principal</Label>
        <select
          id="pref-currency"
          name="defaultCurrency"
          defaultValue={initialCurrency}
          disabled={isPending}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : "Guardar preferencias"}
      </Button>
    </form>
  );
}
