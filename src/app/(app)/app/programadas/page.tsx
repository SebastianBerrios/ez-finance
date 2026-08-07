import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { SupabaseScheduledAdapter } from "@/modules/scheduled/infrastructure/supabase-scheduled-adapter";
import { ScheduledCreator } from "@/modules/scheduled/ui/components/scheduled-creator";
import { ScheduledList } from "@/modules/scheduled/ui/components/scheduled-list";

import { createScheduledAction } from "./create-scheduled.action";
import { toggleScheduledAction } from "./toggle-scheduled.action";

export const metadata: Metadata = {
  title: "Programados — ez finance",
};

/**
 * Movements that repeat every month.
 *
 * WHAT THIS PRODUCES IS ORDINARY TRANSACTIONS. A nightly job writes them into the same
 * table as anything typed by hand, so balances, buckets and reports need to know nothing
 * about schedules. The page says so, because "programado" could just as easily mean a
 * forecast that never becomes real.
 */
export default async function ScheduledPage() {
  const current = await resolveCurrentWorkspace();
  if (!current.ok || current.value.kind !== "READY") {
    redirect("/app");
  }

  const [schedules, accounts, categories] = await Promise.all([
    new SupabaseScheduledAdapter().listByWorkspace(current.value.workspaceId),
    new SupabaseAccountAdapter().listWithBalances(current.value.workspaceId),
    new SupabaseCategoryAdapter().listByWorkspace(current.value.workspaceId),
  ]);

  const openAccounts = accounts.ok
    ? accounts.value
        .filter((account) => !account.archived)
        .map((account) => ({ id: account.id, name: account.name }))
    : [];

  const openCategories = categories.ok
    ? categories.value
        .filter((category) => !category.archived)
        .map((category) => ({ id: category.id, name: category.name }))
    : [];

  const currency = accounts.ok ? (accounts.value[0]?.currency ?? "PEN") : "PEN";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-bold">Programados</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Lo que se repite todos los meses. Se registran solos, como movimientos
          normales — cuentan en tus cubos igual que si los cargaras a mano.
        </p>
      </div>

      {!schedules.ok ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos cargar tus programados. Intenta de nuevo en unos minutos.
        </div>
      ) : (
        <ScheduledList
          action={toggleScheduledAction}
          schedules={schedules.value}
          currency={currency}
        />
      )}

      {openAccounts.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3 text-sm leading-relaxed">
          Necesitas al menos una cuenta activa para programar un movimiento.
        </p>
      ) : (
        <ScheduledCreator
          action={createScheduledAction}
          accounts={openAccounts}
          categories={openCategories}
          currencyLabel="soles"
        />
      )}
    </main>
  );
}
