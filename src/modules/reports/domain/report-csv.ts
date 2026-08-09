// report-csv.ts — a month's report as one table a spreadsheet can pivot.
//
// PURE, and in the domain rather than beside the route handler, because the shape of
// the export IS a product decision: which figures a person gets, in what units, under
// what names. A route handler is where a Response is built, not where that is decided.
//
// ONE TABLE, NOT THREE. A report has three natural sections — the month's totals, the
// three buckets, and the per-category detail — and a CSV carrying three stacked tables
// with blank lines between them is a file no spreadsheet can sort, filter or pivot
// without hand-editing first. So every line is a row of the same shape and a `seccion`
// column says which section it belongs to. Filtering on one column is something people
// already know how to do.
//
// AMOUNTS ARE DECIMAL TEXT, one column, with the currency in its own. Minor units
// would be exact but would also mean every reader has to know the exponent to make
// sense of 31000, and the first thing anyone would do is divide by 100 in a formula —
// which is precisely the rounding this codebase refuses to do. The decimal string is
// produced by slicing the digits, never by dividing.
import type { Bucket } from "@shared/domain/budget-types";
import type { CsvRow } from "@shared/domain/csv";
import { type Money, toParts } from "@shared/domain/money";

import type { CategorySpend, MonthlyReport } from "./monthly-report";

/** The column order, and the header a spreadsheet will show. */
export const REPORT_CSV_COLUMNS = [
  "mes",
  "seccion",
  "concepto",
  "cubo",
  "monto",
  "moneda",
] as const;

/**
 * Display order, need → want → save, matching how every screen reads.
 *
 * The order is domain (the 50/30/20 sequence); the NAMES are not. They are passed in
 * — see reportCsvRows — because shared/ui/bucket-labels.ts is, in its own words, "the
 * ONE place a bucket is given a name", written after five different spellings had
 * drifted across the app. A copy here would be the sixth, in the one artefact a person
 * takes away and keeps. A domain file also has no business importing from shared/ui.
 */
const BUCKET_ORDER: readonly Bucket[] = ["need", "want", "save"];

/**
 * Money as plain decimal text.
 *
 * SLICED, NOT DIVIDED. 31000 minor units at exponent 2 is "310.00", built by padding
 * the digit string and cutting it — the same technique money-input.ts uses in the
 * other direction. Dividing would introduce exactly the float error the whole money
 * domain exists to avoid, in the one artefact a person is most likely to sum.
 */
function amountText(money: Money): string {
  const { minorUnits, exponent } = toParts(money);
  const negative = minorUnits < 0n;
  const digits = (negative ? -minorUnits : minorUnits).toString();
  const sign = negative ? "-" : "";

  if (exponent <= 0) return `${sign}${digits}`;

  const padded = digits.padStart(exponent + 1, "0");
  const whole = padded.slice(0, padded.length - exponent);
  const fraction = padded.slice(padded.length - exponent);

  return `${sign}${whole}.${fraction}`;
}

function row(
  month: string,
  seccion: string,
  concepto: string,
  cubo: string,
  money: Money,
): CsvRow {
  return {
    mes: month,
    seccion,
    concepto,
    cubo,
    monto: amountText(money),
    moneda: toParts(money).currency,
  };
}

/** Every name the export needs, supplied by the caller rather than duplicated here. */
export interface ReportCsvLabels {
  /**
   * Category id → name. A missing entry is NOT dropped: the row keeps the id,
   * because a category removed out from under a historical month still spent the
   * money, and a row that vanished would make the detail stop adding up to the
   * total. Spending with no category at all is named, not left blank.
   */
  readonly categories: ReadonlyMap<string, string>;
  /** The bucket names the rest of the app shows — pass BUCKET_LABEL. */
  readonly buckets: Readonly<Record<Bucket, string>>;
}

/**
 * The rows for one month.
 *
 * `month` is passed in as YYYY-MM rather than derived, so a caller exporting several
 * months can concatenate the rows and still tell them apart.
 */
export function reportCsvRows(
  report: MonthlyReport,
  labels: ReportCsvLabels,
  month: string,
): readonly CsvRow[] {
  const rows: CsvRow[] = [
    row(month, "resumen", "Ingreso", "", report.income),
    row(month, "resumen", "Gasto", "", report.expense),
  ];

  for (const bucket of BUCKET_ORDER) {
    rows.push(
      row(
        month,
        "cubo",
        labels.buckets[bucket],
        bucket,
        report.byBucket[bucket],
      ),
    );
  }

  // Included even at zero: "nothing fell outside the buckets" is information, and a
  // row that appears only sometimes is a column a formula cannot rely on.
  rows.push(row(month, "cubo", "Sin cubo", "", report.unbucketed));

  for (const spend of report.byCategory) {
    rows.push(
      row(
        month,
        "categoria",
        nameOf(spend, labels.categories),
        spend.bucket ?? "",
        spend.total,
      ),
    );
  }

  return rows;
}

function nameOf(
  spend: CategorySpend,
  categoryNames: ReadonlyMap<string, string>,
): string {
  if (spend.categoryId === null) return "Sin categoría";
  return categoryNames.get(spend.categoryId) ?? spend.categoryId;
}

/** The download's filename, e.g. `ez-finance-reporte-2026-08.csv`. */
export function reportCsvFilename(month: string): string {
  return `ez-finance-reporte-${month}.csv`;
}
