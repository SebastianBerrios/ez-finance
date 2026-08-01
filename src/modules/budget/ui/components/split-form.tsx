"use client";

import { useActionState, useState } from "react";

import {
  BUCKET_EXAMPLES,
  BUCKET_LABEL,
  BUCKET_ORDER,
} from "@shared/ui/bucket-labels";
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

const FIELDS = BUCKET_ORDER.map((key) => ({
  key,
  label: BUCKET_LABEL[key],
  hint: BUCKET_EXAMPLES[key],
}));

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

      {/*
        COLLAPSED BY DEFAULT, and a native <details> rather than React state on
        purpose: form controls inside a closed <details> are still in the DOM and
        still submit, so the pre-filled 50/30/20 posts whether or not it was ever
        opened. Conditionally rendering the inputs would have submitted nothing.
        It also needs no JS and gets the disclosure semantics for free.

        The reason it is closed: three number fields and a running total pushed the
        button below the fold on the one screen whose job is to be read. Almost
        nobody changes these, so almost nobody should have to scroll past them.
      */}
      <details className="border-border rounded-lg border">
        <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
          ¿Quieres cambiar el reparto?
        </summary>

        <div className="flex flex-col gap-6 px-4 pt-2 pb-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Cámbialos si tu situación pide otro reparto — solo tienen que sumar
            100. También se puede ajustar más adelante.
          </p>

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
        </div>
      </details>

      {/*
        Disabled until the split is valid — including while the disclosure is shut,
        because a stored split that somehow does not sum to 100 must not sail
        through just because nobody opened the fields. The server validates again
        through the engine's own validateConfig.
      */}
      <Button type="submit" disabled={isPending || !sumIsOk} className="w-full">
        {isPending ? "Guardando…" : submitLabel}
      </Button>
    </form>
  );
}
