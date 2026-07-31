import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/(app)/actions/logout.action";
import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { LogoutButton } from "@/modules/auth/ui/components/logout-button";
import { getMonthlyBudget } from "@/modules/budget/application/get-monthly-budget";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { SupabaseMonthlySnapshotAdapter } from "@/modules/budget/infrastructure/supabase-monthly-snapshot-adapter";
import { BucketCard } from "@/modules/budget/ui/components/bucket-card";
import { MoneyDisplay } from "@shared/ui/money-display";
import { ThemeToggle } from "@shared/ui/theme-toggle";

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/**
 * The dashboard: how much of each bucket is left this month.
 *
 * The (app) layout has already guaranteed a session, a bootstrapped workspace and a
 * finished setup, so none of that is re-checked here. What cannot be assumed is
 * that the COMPUTATION succeeds — a stored config the engine rejects is reachable
 * through drift — so that case gets its own message instead of an empty screen.
 */
export default async function AppPage() {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    // The layout resolves both of these; arriving here means it changed under us.
    redirect("/app/settings");
  }

  const now = new Date();

  const budget = await getMonthlyBudget(
    { workspaceId: entry.value.workspaceId, month: now },
    {
      snapshots: new SupabaseMonthlySnapshotAdapter(),
      budget: new SupabaseBudgetConfigAdapter(),
    },
  );

  // NotConfigured should be unreachable — the layout's gate exists to prevent it —
  // but if the two ever disagree, the wizard is the only place that can fix it.
  if (!budget.ok && budget.error.kind === "NotConfigured") {
    redirect("/onboarding");
  }

  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <main className="flex min-h-screen w-full flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <span className="text-foreground font-semibold">ez finance</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LogoutButton action={logoutAction} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
        <div>
          <p className="text-muted-foreground text-sm capitalize">
            {monthLabel}
          </p>
          <h1 className="text-foreground mt-1 text-2xl font-bold">
            Tu presupuesto
          </h1>
        </div>

        {!budget.ok ? (
          <div
            role="alert"
            className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
          >
            {budget.error.kind === "InvalidConfig"
              ? "Tu presupuesto tiene porcentajes que no suman 100. Ajústalo para ver el resumen."
              : "No pudimos calcular tu presupuesto. Intenta de nuevo en unos minutos."}
          </div>
        ) : (
          <>
            {/*
              The global figure comes first, because "how much is left in total" is
              the question people arrive with. The per-bucket breakdown answers
              "where did it go", which is the second question.
            */}
            <section className="bg-card border-border rounded-xl border p-5">
              <p className="text-muted-foreground text-xs tracking-widest uppercase">
                Disponible del mes
              </p>
              <p className="mt-2">
                <MoneyDisplay
                  amount={budget.value.result.globalAvailable}
                  size="xl"
                />
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Sobre un ingreso de{" "}
                <MoneyDisplay
                  amount={budget.value.result.incomeUsed}
                  size="sm"
                />
              </p>
            </section>

            <BucketCard
              label="Necesidades"
              percentage={budget.value.percentages.need}
              result={budget.value.result.buckets.need}
            />
            <BucketCard
              label="Deseos"
              percentage={budget.value.percentages.want}
              result={budget.value.result.buckets.want}
            />
            <BucketCard
              label="Ahorro"
              percentage={budget.value.percentages.save}
              result={budget.value.result.buckets.save}
            />

            {budget.value.result.alerts.length > 0 && (
              <section
                aria-label="Alertas"
                className="border-border rounded-xl border p-4"
              >
                <p className="text-foreground text-sm font-medium">Atención</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {budget.value.result.alerts.map((alert) => (
                    <li
                      key={`${alert.scope}-${alert.bucket ?? alert.categoryId ?? ""}-${alert.level}`}
                      className="text-muted-foreground text-xs"
                    >
                      {alert.level === "over"
                        ? `Pasaste el límite (${alert.consumedPct}%)`
                        : `Te estás acercando al límite (${alert.consumedPct}%)`}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <Link
          href="/app/settings"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 mt-2 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Configuración</span>
          <span className="text-sm">›</span>
        </Link>
      </div>
    </main>
  );
}
