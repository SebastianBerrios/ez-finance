// bucket-labels.ts — the ONE place a bucket is given a name.
//
// WHY THIS EXISTS. The three buckets had picked up five different spellings across
// the app: the dashboard cards hardcoded "Necesidades" and "Deseos" as props, the
// category picker kept its own map, the transaction form used the singular
// "Necesidad" as a suffix, and the setup screens had grown a longer set
// ("Necesidades primarias", "Caprichos", "Ahorro para el futuro"). Someone
// configuring their split in one screen and reading the result in another was
// being told the same three things by four different names.
//
// Copy, not domain: it lives in shared/ui rather than shared/domain because the
// engine has no opinion about wording — `need | want | save` is the whole domain
// vocabulary, and these are the words a person sees.

import type { Bucket } from "@shared/domain/budget-types";

/** Used wherever a bucket is named: headings, legends, options, inline tags. */
export const BUCKET_LABEL: Readonly<Record<Bucket, string>> = Object.freeze({
  need: "Necesidades",
  want: "Deseos",
  save: "Ahorro",
});

/**
 * What each bucket is FOR, one line, for the first screens where the method is
 * being explained rather than referenced.
 */
export const BUCKET_MEANING: Readonly<Record<Bucket, string>> = Object.freeze({
  need: "lo que no puedes dejar de pagar",
  want: "lo que eliges porque quieres",
  save: "lo que guardas o usas para salir de deudas",
});

/** Concrete examples, for the fields where someone is choosing percentages. */
export const BUCKET_EXAMPLES: Readonly<Record<Bucket, string>> = Object.freeze({
  need: "Alquiler, servicios, comida, transporte, salud.",
  want: "Salidas, suscripciones, ropa, ocio.",
  save: "Lo que guardas o destinas a pagar deudas.",
});

/** Display order, need → want → save, matching how every screen reads. */
export const BUCKET_ORDER: readonly Bucket[] = Object.freeze([
  "need",
  "want",
  "save",
]);
