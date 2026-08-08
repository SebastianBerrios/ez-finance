// csv.ts — write CSV a spreadsheet will open without running it.
//
// EXTRACTED from auth/infrastructure/export-adapter.ts, where it was a private
// function. Two things made that the wrong home once a second exporter appeared:
// eslint-plugin-boundaries forbids the reports module importing another module's
// infrastructure, so the only alternative was a SECOND escaper — and the knowledge
// encoded below (which characters a spreadsheet executes, why quoting does not
// help, why only strings get neutralised) is exactly the kind that must not be
// re-derived by whoever writes the second copy.
//
// Pure and dependency-free, which is why it belongs in shared/domain rather than
// shared/infrastructure: it is a text transformation, not an I/O concern.

export type CsvRow = Record<string, unknown>;

/**
 * Characters that make a spreadsheet treat a cell as a FORMULA.
 *
 * `=`, `+`, `-` and `@` start an expression in Excel, LibreOffice and Sheets; the
 * tab and carriage return are here because they can be used to smuggle one past a
 * naive check. Quoting the field does not help: the quotes are stripped before the
 * value is interpreted.
 */
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

/** RFC 4180 quoting: only when needed, doubling embedded quotes. */
export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  // ONLY strings are neutralised. Stringifying first turned a numeric -1234 into
  // the text '-1234, which a spreadsheet then refuses to sum, sort or chart —
  // every exported amount silently became text. The injection risk only exists for
  // values a person can type; a number cannot carry a formula.
  const isText = typeof value === "string";
  const raw = isText ? value : String(value);
  // A leading apostrophe is the standard neutraliser: spreadsheets read the cell as
  // literal text and do not render the quote.
  const text = isText && CSV_FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * A header row plus one line per row, keyed by an EXPLICIT column list.
 *
 * The columns are a parameter rather than derived from the rows' keys so the order
 * is stable and an empty dataset still exports a valid header — a file with no
 * header is a file a spreadsheet cannot label.
 */
export function toCsv(
  columns: readonly string[],
  rows: readonly CsvRow[],
): string {
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns.map((column) => toCsvValue(row[column])).join(","),
  );
  return [header, ...body].join("\n") + "\n";
}
