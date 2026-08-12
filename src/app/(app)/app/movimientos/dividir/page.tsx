import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { SplitForm } from "@/modules/splits/ui/components/split-form";

import { recordSplitExpenseAction } from "./record-split-expense.action";

export const metadata: Metadata = {
  title: "Dividir un gasto — ez finance",
};

export default async function SplitExpensePage() {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  // Archived means read-only, so there is nothing for this form to submit to. Same
  // reasoning as /app/movimientos/nuevo: the dashboard holds the banner that explains it.
  if (entry.value.isArchived) {
    redirect("/app");
  }

  const [accounts, categories] = await Promise.all([
    new SupabaseAccountAdapter().listByWorkspace(entry.value.workspaceId),
    new SupabaseCategoryAdapter().listByWorkspace(entry.value.workspaceId),
  ]);

  /*
    ARCHIVED and RECEIVABLE accounts are both excluded, for different reasons.
    Archived: it no longer takes new movements. Receivable: "Por cobrar" is not an
    account money leaves from — it is the app's own ledger of what people owe you, and
    paying an expense out of it would mean paying with a debt.
  */
  const payingAccounts = (accounts.ok ? accounts.value : []).filter(
    (account) => !account.archived && account.type !== "receivable",
  );

  if (payingAccounts.length === 0) {
    redirect("/onboarding/cuenta");
  }

  // Archived categories are not offered for new spending, the same as the ordinary form.
  const available = (categories.ok ? categories.value : []).filter(
    (category) => !category.archived,
  );

  // Today from the SERVER, so the default date belongs to the month the dashboard is
  // about to compute rather than to the browser's timezone.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
      <Link
        href="/app"
        className="text-muted-foreground hover:text-foreground mb-4 text-sm transition-colors"
      >
        ← Volver
      </Link>

      <h1 className="text-foreground mb-6 text-2xl font-semibold">
        Dividir un gasto
      </h1>

      <SplitForm
        action={recordSplitExpenseAction}
        accounts={payingAccounts}
        categories={available}
        currencyLabel="soles"
        today={today}
      />
    </main>
  );
}
