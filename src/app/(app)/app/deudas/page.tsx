import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { SupabaseSplitAdapter } from "@/modules/splits/infrastructure/supabase-split-adapter";
import { OwedList } from "@/modules/splits/ui/components/owed-list";

import { settleSplitAction } from "./settle-split.action";

export const metadata: Metadata = {
  title: "Te deben — ez finance",
};

/**
 * Dynamic, like every screen that reads money: a cached list of debts would show one
 * already collected.
 */
export const dynamic = "force-dynamic";

export default async function DebtsPage() {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const [splits, accounts] = await Promise.all([
    new SupabaseSplitAdapter().listOwed(entry.value.workspaceId),
    new SupabaseAccountAdapter().listByWorkspace(entry.value.workspaceId),
  ]);

  /*
    Where a repayment can LAND. Archived accounts are out — they take no new movements —
    and so is "Por cobrar" itself: settling into it would move the debt from one side of
    the receivable account to the other and leave it exactly as unpaid as before.
  */
  const destinations = (accounts.ok ? accounts.value : []).filter(
    (account) => !account.archived && account.type !== "receivable",
  );

  const currency = accounts.ok ? (accounts.value[0]?.currency ?? "PEN") : "PEN";
  const isArchived = entry.value.isArchived;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
      <Link
        href="/app"
        className="text-muted-foreground hover:text-foreground mb-4 text-sm transition-colors"
      >
        ← Volver
      </Link>

      <h1 className="text-foreground mb-2 text-2xl font-semibold">Te deben</h1>
      <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
        Lo que te deben por los gastos que dividiste. No cuenta como gasto tuyo,
        así que no consume tus cubos.
      </p>

      {isArchived && (
        <section
          role="status"
          className="border-border bg-muted/40 mb-6 rounded-xl border px-5 py-4"
        >
          <p className="text-foreground text-sm font-medium">
            Este espacio está en solo lectura
          </p>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            Puedes ver quién te debe, pero no registrar cobros hasta que lo
            restaures.
          </p>
        </section>
      )}

      {/*
        A FAILED read is not "nobody owes you anything". Rendering the empty state here
        would tell someone their debts are settled when the truth is that we could not
        look — the same mistake the dashboard's movement list guards against.
      */}
      {!splits.ok ? (
        <p role="alert" className="text-destructive text-sm">
          No pudimos leer tus deudas. Intenta de nuevo en unos minutos.
        </p>
      ) : (
        <OwedList
          splits={splits.value}
          /*
            No destinations in an archived space, and none if every account is archived:
            the list still renders, the settle control just has nothing to offer. The
            action refuses too, and so does the database.
          */
          accounts={isArchived ? [] : destinations}
          settleAction={settleSplitAction}
          currency={currency}
        />
      )}

      {!isArchived && (
        <Link
          href="/app/movimientos/dividir"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-6 flex items-center justify-center rounded-xl px-5 py-4 text-sm font-medium transition-colors"
        >
          Dividir un gasto
        </Link>
      )}
    </main>
  );
}
