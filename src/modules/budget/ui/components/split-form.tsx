"use client";

import { useActionState, useState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface SplitFormState {
  error?: string;
}

type SplitActionFn = (
  prev: SplitFormState,
  formData: FormData,
) => Promise<SplitFormState>;

interface SplitFormProps {
  action: SplitActionFn;
  initial: { need: number; want: number; save: number };
  /** The wizard's first step continues; a later edit saves. */
  submitLabel: string;
}

const initialState: SplitFormState = {};

/**
 * Labels match the explanation this form sits under, word for word.
 *
 * The dashboard's cards keep the shorter "Necesidades / Deseos / Ahorro" — a card
 * title has room for two words, not four. Here, where the concept is being taught
 * for the first time, the longer phrasing is the point: "Caprichos" tells someone
 * what the 30 % is for in a way "Deseos" does not.
 */
const FIELDS = [
  {
    key: "need" as const,
    label: "Necesidades primarias",
    hint: "Alquiler, servicios, comida, transporte, salud.",
  },
  {
    key: "want" as const,
    label: "Caprichos",
    hint: "Salidas, suscripciones, ropa, ocio.",
  },
  {
    key: "save" as const,
    label: "Ahorro para el futuro",
    hint: "Lo que guardas o destinas a pagar deudas.",
  },
];

/**
 * Whole numbers only, and only in 0–100. Matching the engine, which rejects a
 * fractional percentage outright rather than rounding it — a rounded split would
 * distort every target it produces.
 */
function parsePercentage(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= 0 && value <= 100 ? value : null;
}

export function SplitForm({ action, initial, submitLabel }: SplitFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [values, setValues] = useState({
    need: String(initial.need),
    want: String(initial.want),
    save: String(initial.save),
  });

  const parsed = {
    need: parsePercentage(values.need),
    want: parsePercentage(values.want),
    save: parsePercentage(values.save),
  };

  const allValid =
    parsed.need !== null && parsed.want !== null && parsed.save !== null;
  const sum = allValid ? parsed.need! + parsed.want! + parsed.save! : null;
  const sumIsOk = sum === 100;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {FIELDS.map((field) => (
        <div key={field.key} className="flex flex-col gap-2">
          <Label htmlFor={`split-${field.key}`}>{field.label} (%)</Label>
          <Input
            id={`split-${field.key}`}
            name={field.key}
            type="text"
            inputMode="numeric"
            required
            value={values[field.key]}
            onChange={(event) =>
              setValues((previous) => ({
                ...previous,
                [field.key]: event.target.value,
              }))
            }
            aria-describedby={`split-${field.key}-hint`}
          />
          <p
            id={`split-${field.key}-hint`}
            className="text-muted-foreground text-xs"
          >
            {field.hint}
          </p>
        </div>
      ))}

      {/*
        The running total, announced politely rather than assertively: it updates on
        every keystroke, and an assertive live region would interrupt a screen
        reader mid-word on each one.
      */}
      <p
        aria-live="polite"
        className={
          sumIsOk
            ? "text-muted-foreground text-sm"
            : "text-destructive text-sm font-medium"
        }
      >
        {sum === null
          ? "Escribe los tres porcentajes como números enteros."
          : sumIsOk
            ? "Suman 100 %."
            : `Suman ${sum} %. Tienen que sumar 100 %.`}
      </p>

      {/*
        Disabled until the split is valid. The server validates again through the
        engine's own validateConfig — this only saves a round trip and stops the
        person from discovering the rule by being rejected.
      */}
      <Button type="submit" disabled={isPending || !sumIsOk} className="w-full">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
