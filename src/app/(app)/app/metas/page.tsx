import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { SupabaseGoalAdapter } from "@/modules/goals/infrastructure/supabase-goal-adapter";
import { GoalCreator } from "@/modules/goals/ui/components/goal-creator";
import { GoalList } from "@/modules/goals/ui/components/goal-list";

import { archiveGoalAction } from "./archive-goal.action";
import { createGoalAction } from "./create-goal.action";

export const metadata: Metadata = {
  title: "Metas — ez finance",
};

/**
 * Savings goals.
 *
 * PROGRESS IS THE ACCOUNT'S BALANCE, not a stored figure, which is worth saying on the
 * page itself: it means the money is really there and that nothing here can drift away
 * from the movements you recorded. It also means a goal needs an account, so the page
 * says so rather than offering an empty picker.
 *
 * Only SAVINGS accounts are offered. The engine already treats transfers into a savings
 * account as consuming the 20 % bucket, so a goal backed by a current account would be
 * measuring money the budget considers spendable — which is exactly what a goal is not.
 */
export default async function GoalsPage() {
  const current = await resolveCurrentWorkspace();
  if (!current.ok || current.value.kind !== "READY") {
    redirect("/app");
  }

  const [goals, accounts] = await Promise.all([
    new SupabaseGoalAdapter().listWithProgress(current.value.workspaceId),
    new SupabaseAccountAdapter().listWithBalances(current.value.workspaceId),
  ]);

  const savingsAccounts = accounts.ok
    ? accounts.value
        .filter((account) => !account.archived && account.type === "savings")
        .map((account) => ({ id: account.id, name: account.name }))
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
        <h1 className="text-foreground mt-2 text-2xl font-bold">Metas</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Un monto al que quieres llegar en una cuenta de ahorro. El progreso
          sale del saldo real de esa cuenta, no de un número que se lleve
          aparte.
        </p>
      </div>

      {!goals.ok ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos cargar tus metas. Intenta de nuevo en unos minutos.
        </div>
      ) : (
        <GoalList
          action={archiveGoalAction}
          goals={goals.value}
          currency={currency}
        />
      )}

      {savingsAccounts.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3 text-sm leading-relaxed">
          Para crear una meta necesitas una cuenta de tipo{" "}
          <strong className="text-foreground">Ahorro</strong>. Creá una en{" "}
          <Link href="/app/cuentas" className="underline">
            Cuentas
          </Link>{" "}
          y vuelve.
        </p>
      ) : (
        <GoalCreator action={createGoalAction} accounts={savingsAccounts} />
      )}
    </main>
  );
}
