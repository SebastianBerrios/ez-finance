import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseMonthlySnapshotAdapter } from "@/modules/budget/infrastructure/supabase-monthly-snapshot-adapter";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { exportMonthlyReportCsv } from "@/modules/reports/application/export-monthly-report";
import { BUCKET_LABEL } from "@shared/ui/bucket-labels";

import { parseMonth, toParam } from "../month-param";

/**
 * The month's report as a CSV download.
 *
 * A ROUTE HANDLER AND NOT A SERVER ACTION, because the result is a FILE. An action
 * returns state to a React tree; a download needs its own response with its own
 * Content-Type and Content-Disposition, and the browser has to navigate to it.
 *
 * IT AUTHENTICATES ITSELF. The (app) layout gates the pages under it, and a route
 * handler is NOT wrapped by a layout — so the check that every page in this folder
 * inherits has to be written here explicitly. resolveCurrentWorkspace() does both
 * halves: it refuses without a session and resolves which workspace the request is
 * about, ignoring a cookie that is not the caller's.
 *
 * RLS is still what scopes the data. The adapters read through the caller's own
 * session and this handler never uses a service key, so the worst a mangled request
 * can do is export the caller's own month.
 */
export async function GET(request: Request): Promise<Response> {
  const current = await resolveCurrentWorkspace();

  if (!current.ok) {
    return new Response("No autorizado", { status: 401 });
  }

  if (current.value.kind !== "READY") {
    // A DELETED account has nothing to export and no screen to be sent to.
    return new Response("No autorizado", { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get("mes") ?? undefined;
  // Same fallback as the page: the parameter is a convenience, and refusing to export
  // because someone mangled a query string would be theatre. Falling back to this
  // month means the file's own `mes` column still says which month it is.
  const month = parseMonth(raw) ?? new Date();

  const monthParam = toParam(month);

  // Names are resolved HERE and passed in: the snapshot carries ids and buckets
  // because that is all the engine needs, and widening it for a label would change
  // what the dashboard reads too.
  const categories = await new SupabaseCategoryAdapter().listByWorkspace(
    current.value.workspaceId,
  );

  const artifact = await exportMonthlyReportCsv(
    {
      workspaceId: current.value.workspaceId,
      month,
      monthParam,
      labels: {
        categories: new Map(
          categories.ok ? categories.value.map((c) => [c.id, c.name]) : [],
        ),
        // The same map every screen reads its bucket names from, so the file a
        // person keeps cannot disagree with the dashboard they exported it from.
        buckets: BUCKET_LABEL,
      },
    },
    { snapshots: new SupabaseMonthlySnapshotAdapter() },
  );

  if (!artifact.ok) {
    // 200 with a broken file would be the worst outcome: a spreadsheet opens it and
    // shows a month of zeroes, which reads as "you spent nothing".
    const status = artifact.error.kind === "Unavailable" ? 503 : 409;
    return new Response("No pudimos preparar el reporte", { status });
  }

  // null means the workspace has no base currency — no account, so no month to
  // report. NOT an error and NOT an empty CSV: a file of zeroes says "you spent
  // nothing", which is a different claim from "there is nothing here yet".
  if (artifact.value === null) {
    return new Response(
      "Este espacio todavía no tiene cuentas, así que no hay nada que exportar.",
      { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  return new Response(artifact.value.csv, {
    status: 200,
    headers: {
      // charset declared because the names are Spanish: without it Excel on Windows
      // reads the bytes as its legacy code page and "Categoría" arrives mangled.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${artifact.value.filename}"`,
      // A month's figures change whenever a movement is recorded, so a cached copy is
      // a wrong copy. private, because the response is one person's finances.
      "cache-control": "private, no-store",
    },
  });
}
