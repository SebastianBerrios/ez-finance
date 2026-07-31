import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { TransactionForm } from "@/modules/transactions/ui/components/transaction-form";

import { recordTransactionAction } from "./record-transaction.action";

export const metadata: Metadata = {
  title: "Nuevo movimiento — ez finance",
};

export default async function NewTransactionPage() {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const [accounts, categories] = await Promise.all([
    new SupabaseAccountAdapter().listByWorkspace(entry.value.workspaceId),
    new SupabaseCategoryAdapter().listByWorkspace(entry.value.workspaceId),
  ]);

  // Without an account there is nowhere to record a movement, and the wizard is
  // where that gets fixed. Reachable only if someone deleted their last account,
  // since the (app) gate requires one.
  if (!accounts.ok || accounts.value.length === 0) {
    redirect("/onboarding/cuenta");
  }

  // Today resolved on the SERVER, so the date the form defaults to matches the
  // month the dashboard is about to compute — a browser in another timezone could
  // otherwise pre-fill a day that belongs to a different month.
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
        Nuevo movimiento
      </h1>

      <TransactionForm
        action={recordTransactionAction}
        accounts={accounts.value}
        categories={categories.ok ? categories.value : []}
        currencyLabel="soles"
        today={today}
      />
    </main>
  );
}
