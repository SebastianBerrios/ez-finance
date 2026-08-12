import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/(app)/actions/logout.action";
import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import type { AccountWithBalance } from "@/modules/accounts/application/ports/account-port";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { LogoutButton } from "@/modules/auth/ui/components/logout-button";
import { getMonthlyBudget } from "@/modules/budget/application/get-monthly-budget";
import { SupabaseBudgetConfigAdapter } from "@/modules/budget/infrastructure/supabase-budget-config-adapter";
import { SupabaseMonthlySnapshotAdapter } from "@/modules/budget/infrastructure/supabase-monthly-snapshot-adapter";
import { BucketCard } from "@/modules/budget/ui/components/bucket-card";
import {
  goalsNeedingAttention,
  listGoalsWithPace,
} from "@/modules/goals/application/list-goals-with-pace";
import { SupabaseGoalAdapter } from "@/modules/goals/infrastructure/supabase-goal-adapter";
import { listDueSoon } from "@/modules/scheduled/application/list-due-soon";
import { SupabaseScheduledAdapter } from "@/modules/scheduled/infrastructure/supabase-scheduled-adapter";
import { SupabaseTransactionAdapter } from "@/modules/transactions/infrastructure/supabase-transaction-adapter";
import { MovementList } from "@/modules/transactions/ui/components/movement-list";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";
import { type Money, fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { BUCKET_LABEL, BUCKET_ORDER } from "@shared/ui/bucket-labels";
import { MoneyDisplay } from "@shared/ui/money-display";
import { ThemeToggle } from "@shared/ui/theme-toggle";

import { deleteMovementAction } from "./delete-movement.action";

/**
 * A balance as Money, for MoneyDisplay.
 *
 * fromMinorUnits validates the currency and can fail, but the code came out of a
 * column the app only ever writes from the supported set — a failure here means the
 * database holds something no app path produced, so zero is shown rather than
 * crashing the whole dashboard over one row.
 */
function accountMoney(account: AccountWithBalance): Money {
  const money = fromMinorUnits(account.currency, account.balanceMinorUnits);
  return money.ok ? money.value : expectOk(fromMinorUnits("PEN", 0n));
}

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
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    // The layout resolves both of these; arriving here means it changed under us.
    redirect("/app/settings");
  }

  const now = new Date();

  // Memoized for this request by the layout, so this is a cache hit rather than a
  // second round trip to the Auth server.
  const { user } = await getAuthenticatedUser();

  const [accounts, movements, goals, dueSoon] = await Promise.all([
    new SupabaseAccountAdapter().listWithBalances(entry.value.workspaceId),
    new SupabaseTransactionAdapter().listForMonth(
      entry.value.workspaceId,
      now,
      user?.id ?? "",
    ),
    // The two alert sources spec §5.11 asks for and the app did not have: a goal
    // falling behind, and a schedule about to run. Both are DERIVED — the pace from
    // the goal's own window, the next occurrence from its day of month — so neither
    // adds a query beyond the list it already needed.
    listGoalsWithPace(
      { workspaceId: entry.value.workspaceId, today: now },
      { goals: new SupabaseGoalAdapter() },
    ),
    listDueSoon(
      { workspaceId: entry.value.workspaceId, today: now },
      { scheduled: new SupabaseScheduledAdapter() },
    ),
  ]);

  // A FAILED read produces no alerts rather than a broken panel. Not being able to
  // check whether a goal is behind is not the same as it being fine, but the dashboard
  // is not the screen to argue that on — /app/metas says so where it matters.
  const attention = goals.ok ? goalsNeedingAttention(goals.value) : [];
  const upcoming = dueSoon.ok ? dueSoon.value : [];

  const budget = await getMonthlyBudget(
    { workspaceId: entry.value.workspaceId, month: now },
    {
      snapshots: new SupabaseMonthlySnapshotAdapter(),
      budget: new SupabaseBudgetConfigAdapter(),
    },
  );

  // NotConfigured means two completely different things now, and conflating them is
  // an INFINITE REDIRECT LOOP — one this very change introduced and this line stops.
  //
  // On the personal space it is the old case: the gate and the data disagree, and the
  // wizard is the only thing that can rebuild a config from nothing.
  //
  // On a space you just created it is simply the truth — it has no accounts and no
  // budget yet. Sending that to /onboarding bounces straight back, because the wizard
  // root checks the PERSONAL workspace, finds it complete, and redirects to /app,
  // which lands here again. The browser gives up before either page does.
  const needsSetup = !budget.ok && budget.error.kind === "NotConfigured";

  if (needsSetup && entry.value.isPersonal) {
    redirect("/onboarding");
  }

  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  const isArchived = entry.value.isArchived;

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

        {/*
          SAID BEFORE ANYTHING ELSE when the space is archived. Every write path
          refuses for this workspace (20260807210000), so a dashboard that looked
          normal would offer buttons the database declines — which is the failure
          archiving was supposed to prevent, not cause. The numbers stay: reports
          surviving is the whole reason to archive instead of delete.
        */}
        {isArchived && (
          <section
            role="status"
            className="border-border bg-muted/40 rounded-xl border px-5 py-4"
          >
            <p className="text-foreground text-sm font-medium">
              Este espacio está en solo lectura
            </p>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              Lo archivaste, así que conserva sus reportes pero no acepta
              movimientos nuevos. Puedes restaurarlo desde Espacios.
            </p>
            <Link
              href="/app/espacios"
              className="text-foreground mt-3 inline-flex text-sm font-medium underline"
            >
              Ir a Espacios
            </Link>
          </section>
        )}

        {needsSetup ? (
          /*
            A new space, not a broken one. It says what is missing and links to the two
            screens that fix it, in the order they have to happen: the account fixes
            the currency, the budget needs an income to divide.
          */
          <section className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
            <p className="text-foreground text-sm font-medium">
              Este espacio todavía está vacío
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Cada espacio tiene su propio presupuesto. Agrega una cuenta y
              define cuánto esperas recibir para que aparezcan tus cubos.
            </p>
            <div className="mt-1 flex flex-col gap-2">
              <Link
                href="/app/cuentas"
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium transition-colors"
              >
                Agregar una cuenta
              </Link>
              <Link
                href="/app/presupuesto"
                className="border-border text-foreground hover:bg-muted/40 flex items-center justify-center rounded-md border px-4 py-3 text-sm font-medium transition-colors"
              >
                Definir el presupuesto
              </Link>
            </div>
          </section>
        ) : !budget.ok ? (
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

            {/*
              Mapped rather than three hardcoded labels: these were the strings the
              rest of the app was supposed to agree with, and being written here as
              literals is how the setup screens drifted away from them.
            */}
            {BUCKET_ORDER.map((key) => (
              <BucketCard
                key={key}
                label={BUCKET_LABEL[key]}
                percentage={budget.value.percentages[key]}
                result={budget.value.result.buckets[key]}
              />
            ))}

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

        {/*
          A SECOND panel, and outside the budget branch on purpose. The bucket alerts
          above are budget OUTPUT — they only exist when the month computed. A goal
          falling behind or a charge landing on Friday matters just as much when the
          budget config is broken, and burying them inside that branch would hide them
          exactly when the dashboard is least useful.

          Two panels rather than one merged list because they answer different
          questions: "how are my cubes doing" versus "what is coming".
        */}
        {(attention.length > 0 || upcoming.length > 0) && (
          <section
            aria-label="Avisos"
            className="border-border rounded-xl border p-4"
          >
            <p className="text-foreground text-sm font-medium">Te avisamos</p>
            <ul className="mt-2 flex flex-col gap-2">
              {upcoming.map((due) => (
                <li key={due.id} className="text-muted-foreground text-xs">
                  {/*
                    The DAY, not just "en 3 días": someone deciding whether to move
                    money needs the date they are planning around. Both are given
                    because the countdown is what makes it feel close.
                  */}
                  <span className="text-foreground">{due.name}</span>{" "}
                  {due.kind === "income" ? "entra" : "sale"}{" "}
                  {due.daysUntil === 0
                    ? "hoy"
                    : due.daysUntil === 1
                      ? "mañana"
                      : `en ${due.daysUntil} días`}{" "}
                  ({due.occursOn})
                </li>
              ))}

              {attention.map((item) => (
                <li
                  key={item.goal.id}
                  className="text-muted-foreground text-xs"
                >
                  <span className="text-foreground">{item.goal.name}</span>{" "}
                  {item.pace?.kind === "OVERDUE"
                    ? "pasó su fecha y todavía le falta"
                    : "va atrasada para su fecha"}
                </li>
              ))}
            </ul>

            <Link
              href="/app/programadas"
              className="text-muted-foreground hover:text-foreground mt-3 inline-flex text-xs underline"
            >
              Ver programados
            </Link>
          </section>
        )}

        {accounts.ok && accounts.value.length > 0 && (
          <section className="bg-card border-border rounded-xl border p-5">
            <h2 className="text-muted-foreground text-xs tracking-widest uppercase">
              Tus cuentas
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {/*
                Archived accounts are shown, marked. Their money still exists, and a
                balance that vanished on archive would be a lie — but they are
                labelled so the list does not look like it has duplicates.
              */}
              {accounts.value.map((account) => (
                <li
                  key={account.id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-foreground text-sm">
                    {account.name}
                    {account.archived && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        archivada
                      </span>
                    )}
                  </span>
                  <MoneyDisplay
                    amount={accountMoney(account)}
                    size="sm"
                    variant={
                      account.balanceMinorUnits < 0n ? "expense" : "neutral"
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="bg-card border-border rounded-xl border p-5">
          <h2 className="text-muted-foreground text-xs tracking-widest uppercase">
            Movimientos del mes
          </h2>
          <div className="mt-3">
            {/*
              A FAILED read is not an empty month. Rendering the empty state here
              would say "you recorded nothing" when the truth is "we could not
              look" — and that is exactly how a broken query hid behind a
              plausible screen while this was being built.
            */}
            {movements.ok ? (
              <MovementList
                movements={movements.value}
                deleteAction={deleteMovementAction}
                currency={
                  accounts.ok ? (accounts.value[0]?.currency ?? "PEN") : "PEN"
                }
              />
            ) : (
              <p role="alert" className="text-destructive text-sm">
                No pudimos leer tus movimientos. Intenta de nuevo en unos
                minutos.
              </p>
            )}
          </div>
        </section>

        {/*
          The primary action, and placed after the numbers on purpose: the person
          reads where they stand, then records. Recording is also the ONLY way any
          of the figures above ever move.

          Absent in an archived space rather than disabled: a greyed-out button
          invites a click and explains nothing, and the banner above has already
          said why. The route refuses too, and so does the database.
        */}
        {!isArchived && (
          <Link
            href="/app/movimientos/nuevo"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 flex items-center justify-center rounded-xl px-5 py-4 text-sm font-medium transition-colors"
          >
            Registrar movimiento
          </Link>
        )}

        {/*
          The management doors. Below the numbers because they are the exception —
          you set your categories up once and then record against them for months.
          Without these the app had no way to add a category or an account after
          setup, and setup cannot be re-entered.
        */}
        {/*
          Above the rest of the management doors because it holds MONEY that is owed to
          you — it belongs with the numbers, not with the setup screens. Shown even in an
          archived space: reading who owes you is exactly what archiving preserves.
        */}
        <Link
          href="/app/deudas"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Te deben</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/programadas"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Programados</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/metas"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Metas</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/reportes"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Reportes</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/espacios"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Espacios</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/presupuesto"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Presupuesto</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/cuentas"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Cuentas</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/categorias"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Categorías</span>
          <span className="text-sm">›</span>
        </Link>

        <Link
          href="/app/settings"
          className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-between rounded-xl border px-5 py-4 transition-colors"
        >
          <span className="text-sm font-medium">Configuración</span>
          <span className="text-sm">›</span>
        </Link>
      </div>
    </main>
  );
}
