import type { MonthlyReport } from "@/modules/reports/domain/monthly-report";
import { monthlyReport } from "@/modules/reports/domain/monthly-report";
import { err, ok, type Result } from "@shared/domain/result";

import type {
  ReportSnapshotError,
  ReportSnapshotPort,
} from "./ports/report-snapshot-port";

interface GetMonthlyReportInput {
  readonly workspaceId: string;
  readonly month: Date;
}

interface GetMonthlyReportDeps {
  readonly snapshots: ReportSnapshotPort;
}

/**
 * The month's spending, broken down.
 *
 * READS THE SAME SNAPSHOT THE ENGINE DOES, through a port whose shape matches the
 * budget module's — so the delivery layer can hand it that module's adapter and the
 * two features can never disagree about a month. The snapshot already carries the
 * transactions, the categories and their buckets, because the engine needs exactly
 * that; a report is an aggregation, not a second query.
 *
 * `null` means the workspace has no base currency, i.e. no account, so it cannot have
 * transactions. Reported as its own case rather than as zeroes, because "nothing to
 * report yet" and "a month where nothing happened" should not look the same.
 */
export async function getMonthlyReport(
  input: GetMonthlyReportInput,
  deps: GetMonthlyReportDeps,
): Promise<Result<MonthlyReport | null, ReportSnapshotError>> {
  const snapshot = await deps.snapshots.readForMonth(
    input.workspaceId,
    input.month,
  );

  if (!snapshot.ok) return err(snapshot.error);
  if (snapshot.value === null) return ok(null);

  return ok(monthlyReport(snapshot.value));
}
