import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { AccountForm } from "@/modules/accounts/ui/components/account-form";
import { AccountList } from "@/modules/accounts/ui/components/account-list";

import { archiveAccountAction } from "./archive-account.action";
import { createAccountAction } from "./create-account.action";

export const metadata: Metadata = {
  title: "Cuentas — ez finance",
};

/**
 * Manage accounts.
 *
 * WHY THIS PAGE EXISTS. createAccount had exactly one caller — the onboarding
 * action — so the first account was the only account a workspace could ever have.
 * Anyone with cash, a bank account and a wallet could record all three only as one.
 *
 * The balances shown are computed in SQL by account_balances(), the single place the
 * sign rule lives, so this page cannot disagree with the dashboard about what an
 * account holds.
 */
export default async function AccountsPage() {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const accounts = await new SupabaseAccountAdapter().listWithBalances(
    entry.value.workspaceId,
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-bold">Cuentas</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Donde tienes tu dinero. El saldo se calcula con todo lo que
          registraste, no es un número que se edite.
        </p>
      </div>

      {!accounts.ok ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos cargar tus cuentas. Intenta de nuevo en unos minutos.
        </div>
      ) : (
        <AccountList action={archiveAccountAction} accounts={accounts.value} />
      )}

      {/*
        The same form the wizard uses. It shows the currency as static text rather
        than a field, which is exactly right here too: the workspace's base currency
        was fixed by the first account and cannot change.
      */}
      <details className="border-border rounded-lg border">
        <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
          Agregar una cuenta
        </summary>

        <div className="px-4 pt-2 pb-4">
          <AccountForm action={createAccountAction} currencyLabel="soles" />
        </div>
      </details>
    </main>
  );
}
