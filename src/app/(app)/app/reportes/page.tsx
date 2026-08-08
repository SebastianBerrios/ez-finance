import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseMonthlySnapshotAdapter } from "@/modules/budget/infrastructure/supabase-monthly-snapshot-adapter";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { getMonthlyReport } from "@/modules/reports/application/get-monthly-report";
import { BUCKET_LABEL, BUCKET_ORDER } from "@shared/ui/bucket-labels";
import { MoneyDisplay } from "@shared/ui/money-display";

import { MONTH_NAMES, monthLabel, parseMonth, toParam } from "./month-param";

export const metadata: Metadata = {
  title: "Reportes — ez finance",
};

/**
 * Where the month's money went.
 *
 * THE MONTH COMES FROM THE URL, not from state, so a particular month is a link
 * someone can keep. An unparseable value falls back to this month rather than
 * erroring: the parameter is a convenience, and refusing to render because someone
 * mangled a query string would be theatre.
 *
 * The dashboard answers "how much is left"; this answers "where did it go". They read
 * the SAME snapshot through the same port, so they cannot disagree about a month.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const current = await resolveCurrentWorkspace();
  if (!current.ok || current.value.kind !== "READY") {
    redirect("/app");
  }

  const params = await searchParams;
  const month = parseMonth(params.mes) ?? new Date();

  const [report, categories] = await Promise.all([
    // The BUDGET adapter, injected into the REPORTS port. The two ports have the same
    // shape on purpose, so the dashboard and this page read one month one way and can
    // never disagree about it — and neither module imports the other.
    getMonthlyReport(
      { workspaceId: current.value.workspaceId, month },
      { snapshots: new SupabaseMonthlySnapshotAdapter() },
    ),
    // Names live on the category rows; the snapshot carries only ids and buckets,
    // because that is all the engine needs. Resolved here rather than widening the
    // snapshot for a label.
    new SupabaseCategoryAdapter().listByWorkspace(current.value.workspaceId),
  ]);

  const nameOf = new Map(
    categories.ok ? categories.value.map((c) => [c.id, c.name]) : [],
  );

  const previous = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const label = monthLabel(month);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-bold">Reportes</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          En qué se fue tu dinero. Las transferencias entre tus cuentas no
          cuentan como gasto.
        </p>
      </div>

      <nav className="flex items-center justify-between gap-3">
        <Link
          href={`/app/reportes?mes=${toParam(previous)}`}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← {MONTH_NAMES[previous.getMonth()]}
        </Link>
        <span className="text-foreground text-sm font-medium capitalize">
          {label}
        </span>
        <Link
          href={`/app/reportes?mes=${toParam(next)}`}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          {MONTH_NAMES[next.getMonth()]} →
        </Link>
      </nav>

      {/*
        The two exports, side by side because they answer different questions. The CSV
        is the DATA — one table a spreadsheet can pivot. The printable view is the
        VISUAL one, and it is the PDF: the browser's own "Guardar como PDF" beats a
        server-side renderer that would add megabytes of dependency and a second layout
        engine to keep in agreement with this page.

        Offered even when the month is empty. Finding out that a month exported nothing
        is a legitimate answer, and a button that appears only sometimes is a button
        people stop looking for.
      */}
      <div className="flex items-center gap-2">
        <a
          href={`/app/reportes/export?mes=${toParam(month)}`}
          className="border-border text-foreground hover:bg-muted/40 flex flex-1 items-center justify-center rounded-md border px-3 py-2 text-sm transition-colors"
          download
        >
          Descargar CSV
        </a>
        <Link
          href={`/app/reportes/imprimir?mes=${toParam(month)}`}
          className="border-border text-foreground hover:bg-muted/40 flex flex-1 items-center justify-center rounded-md border px-3 py-2 text-sm transition-colors"
        >
          Ver para imprimir
        </Link>
      </div>

      {!report.ok ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos leer ese mes. Intenta de nuevo en unos minutos.
        </div>
      ) : report.value === null ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          Este espacio todavía no tiene cuentas, así que no hay nada que
          reportar.
        </p>
      ) : (
        <>
          <section className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
            <p className="text-muted-foreground flex items-baseline justify-between text-sm">
              <span>Ingresos</span>
              <MoneyDisplay amount={report.value.income} size="sm" />
            </p>
            <p className="text-muted-foreground flex items-baseline justify-between text-sm">
              <span>Gastos</span>
              <MoneyDisplay
                amount={report.value.expense}
                size="sm"
                variant="expense"
              />
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-foreground text-sm font-medium">Por cubo</h2>
            {BUCKET_ORDER.map((bucket) => (
              <p
                key={bucket}
                className="text-muted-foreground border-border flex items-baseline justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{BUCKET_LABEL[bucket]}</span>
                <MoneyDisplay
                  amount={report.value!.byBucket[bucket]}
                  size="sm"
                />
              </p>
            ))}

            {/*
              Shown only when it is not zero, and shown plainly when it is not: money
              that left an account and belongs to none of the three cubes is the
              difference people notice on the dashboard and cannot explain.
            */}
            {report.value.unbucketed.minorUnits > 0n && (
              <p className="text-muted-foreground border-border flex items-baseline justify-between rounded-md border border-dashed px-3 py-2 text-sm">
                <span>Sin cubo</span>
                <MoneyDisplay amount={report.value.unbucketed} size="sm" />
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-foreground text-sm font-medium">
              Por categoría
            </h2>

            {report.value.byCategory.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No registraste gastos en {label}.
              </p>
            ) : (
              report.value.byCategory.map((row) => (
                <p
                  key={row.categoryId ?? "none"}
                  className="text-muted-foreground border-border flex items-baseline justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="text-foreground">
                    {row.categoryId === null
                      ? "Sin categoría"
                      : (nameOf.get(row.categoryId) ?? "Sin categoría")}
                    {row.bucket !== null && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        {BUCKET_LABEL[row.bucket]}
                      </span>
                    )}
                  </span>
                  <MoneyDisplay amount={row.total} size="sm" />
                </p>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
