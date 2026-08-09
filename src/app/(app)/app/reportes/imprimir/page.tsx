import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseMonthlySnapshotAdapter } from "@/modules/budget/infrastructure/supabase-monthly-snapshot-adapter";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { getMonthlyReport } from "@/modules/reports/application/get-monthly-report";
import { BUCKET_LABEL, BUCKET_ORDER } from "@shared/ui/bucket-labels";
import { MoneyDisplay } from "@shared/ui/money-display";

import { monthLabel, parseMonth } from "../month-param";

export const metadata: Metadata = {
  title: "Reporte para imprimir — ez finance",
};

/**
 * The month's report, laid out for paper.
 *
 * THIS IS THE PDF, and the decision deserves stating rather than hiding. Spec §5.10
 * asks for CSV and PDF, and its own open question is whether the PDF is "un resumen
 * visual o un export de datos". The CSV is the data export. For the visual one, this
 * is a page the browser prints — Ctrl+P → Guardar como PDF — instead of a server-side
 * renderer.
 *
 * WHY NOT A PDF LIBRARY. pdfkit or a headless Chrome would add a dependency measured
 * in megabytes, its own font handling, and a second layout engine that has to be kept
 * agreeing with the screen's — to produce a file the browser already produces from
 * markup we already have. It is also the only option that works from the phone this
 * app is designed for: mobile browsers print to PDF natively, and a server renderer
 * would need a function that can run Chromium.
 *
 * WHAT PAPER CHANGES. No app chrome, no navigation, one column, and every figure
 * present at once — a printed page cannot be scrolled or expanded, so anything behind
 * an interaction has to be laid flat. The `print:` variants hide what is only useful
 * on screen; the page is readable in both.
 */
export default async function PrintableReportPage({
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
    getMonthlyReport(
      { workspaceId: current.value.workspaceId, month },
      { snapshots: new SupabaseMonthlySnapshotAdapter() },
    ),
    new SupabaseCategoryAdapter().listByWorkspace(current.value.workspaceId),
  ]);

  const nameOf = new Map(
    categories.ok ? categories.value.map((c) => [c.id, c.name]) : [],
  );

  const label = monthLabel(month);

  if (!report.ok) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
        <p role="alert" className="text-destructive text-sm">
          No pudimos preparar el reporte de {label}. Intenta de nuevo en unos
          minutos.
        </p>
        <Link href="/app/reportes" className="text-sm underline print:hidden">
          ← Volver a reportes
        </Link>
      </main>
    );
  }

  if (report.value === null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Este espacio todavía no tiene cuentas, así que no hay nada que
          reportar en {label}.
        </p>
        <Link href="/app/reportes" className="text-sm underline print:hidden">
          ← Volver a reportes
        </Link>
      </main>
    );
  }

  // Bound once, after both guards. TypeScript cannot carry the narrowing across two
  // separate `if`s on different properties of the same Result, and sprinkling `!`
  // through the markup would be asserting what the guards already proved.
  const data = report.value;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {/*
        On screen only: a way back, and the instruction. There is no automatic
        window.print() — a page that opens a system dialog on load takes control of the
        browser away from the person who navigated there, and the whole reason to use
        the browser's printer is that they already know how to drive it.
      */}
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          href={`/app/reportes?mes=${params.mes ?? ""}`}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Volver a reportes
        </Link>
        <p className="text-muted-foreground text-xs">
          Usa Imprimir (Ctrl+P) y elige «Guardar como PDF».
        </p>
      </div>

      <header className="border-border border-b pb-4">
        <h1 className="text-foreground text-xl font-bold">
          Reporte de {label}
        </h1>
        <p className="text-muted-foreground mt-1 text-xs">
          ez finance · generado desde la app
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs tracking-widest uppercase">
          Resumen
        </h2>
        <dl className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-foreground text-sm">Ingreso</dt>
            <dd>
              <MoneyDisplay amount={data.income} size="sm" variant="income" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-foreground text-sm">Gasto</dt>
            <dd>
              <MoneyDisplay amount={data.expense} size="sm" variant="expense" />
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs tracking-widest uppercase">
          Por cubo
        </h2>
        <dl className="flex flex-col gap-1">
          {BUCKET_ORDER.map((bucket) => (
            <div
              key={bucket}
              className="flex items-baseline justify-between gap-4"
            >
              <dt className="text-foreground text-sm">
                {BUCKET_LABEL[bucket]}
              </dt>
              <dd>
                <MoneyDisplay amount={data.byBucket[bucket]} size="sm" />
              </dd>
            </div>
          ))}
          {/*
            Shown on paper even at zero. On screen an absent row is a scroll away
            from being noticed; on a printed sheet it is a figure the reader will
            assume was omitted.
          */}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground text-sm">Sin cubo</dt>
            <dd>
              <MoneyDisplay amount={data.unbucketed} size="sm" />
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs tracking-widest uppercase">
          Por categoría
        </h2>

        {data.byCategory.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hubo gastos en este mes.
          </p>
        ) : (
          <dl className="divide-border flex flex-col divide-y">
            {data.byCategory.map((spend) => (
              <div
                key={spend.categoryId ?? "sin-categoria"}
                className="flex items-baseline justify-between gap-4 py-1.5"
              >
                <dt className="text-foreground text-sm">
                  {spend.categoryId === null
                    ? "Sin categoría"
                    : /*
                        The id when the name is unknown, never a blank: a category
                        removed out from under a historical month still spent the
                        money, and a row that vanished would stop the detail adding
                        up to the total above.
                      */
                      (nameOf.get(spend.categoryId) ?? spend.categoryId)}
                  {spend.bucket !== null && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {BUCKET_LABEL[spend.bucket]}
                    </span>
                  )}
                </dt>
                <dd>
                  <MoneyDisplay amount={spend.total} size="sm" />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </main>
  );
}
