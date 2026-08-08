import { monthlyReport } from "@/modules/reports/domain/monthly-report";
import {
  REPORT_CSV_COLUMNS,
  type ReportCsvLabels,
  reportCsvFilename,
  reportCsvRows,
} from "@/modules/reports/domain/report-csv";
import { toCsv } from "@shared/domain/csv";
import { err, ok, type Result } from "@shared/domain/result";

import type {
  ReportSnapshotError,
  ReportSnapshotPort,
} from "./ports/report-snapshot-port";

export interface ReportCsvArtifact {
  readonly filename: string;
  readonly csv: string;
}

interface ExportMonthlyReportInput {
  readonly workspaceId: string;
  readonly month: Date;
  /**
   * Category and bucket names, resolved by the DELIVERY layer.
   *
   * Not looked up here: bucket copy lives in shared/ui/bucket-labels.ts, and neither
   * a domain nor an application file should import from the UI layer to get it.
   */
  readonly labels: ReportCsvLabels;
  /** The month as YYYY-MM, so every row can say which month it belongs to. */
  readonly monthParam: string;
}

interface ExportMonthlyReportDeps {
  readonly snapshots: ReportSnapshotPort;
}

/**
 * The month's report as a finished CSV file.
 *
 * THIS EXISTS BECAUSE OF A BOUNDARY, and the boundary is right. The route handler
 * needs the CSV, and eslint-plugin-boundaries forbids the app layer importing a
 * module's DOMAIN — so composing monthlyReport() with reportCsvRows() and toCsv()
 * inside the handler was not an option. Pushing it here is not a workaround: "what
 * the export contains" is application-level, and the handler is left doing only what
 * a handler should — reading the query string and building a Response.
 *
 * `null` has the same meaning it has in getMonthlyReport: the workspace has no base
 * currency, so it has no account and there is no month to report. Deliberately not an
 * empty CSV — a file of zeroes claims "you spent nothing", which is a different
 * statement from "there is nothing here yet".
 */
export async function exportMonthlyReportCsv(
  input: ExportMonthlyReportInput,
  deps: ExportMonthlyReportDeps,
): Promise<Result<ReportCsvArtifact | null, ReportSnapshotError>> {
  const snapshot = await deps.snapshots.readForMonth(
    input.workspaceId,
    input.month,
  );

  if (!snapshot.ok) return err(snapshot.error);
  if (snapshot.value === null) return ok(null);

  const report = monthlyReport(snapshot.value);

  return ok({
    filename: reportCsvFilename(input.monthParam),
    csv: toCsv(
      REPORT_CSV_COLUMNS,
      reportCsvRows(report, input.labels, input.monthParam),
    ),
  });
}
