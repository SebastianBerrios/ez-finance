import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseAccountAdapter } from "@/modules/accounts/infrastructure/supabase-account-adapter";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { SupabaseTransactionAdapter } from "@/modules/transactions/infrastructure/supabase-transaction-adapter";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";
import { formatMinorUnitsForInput } from "@shared/domain/money-input";

import { OfflineTransactionForm } from "../../offline-transaction-form";

import { editMovementAction } from "./edit-movement.action";

export const metadata: Metadata = {
  title: "Editar movimiento — ez finance",
};

const MINOR_UNIT_EXPONENT = 2;

/**
 * Correct a movement that was already recorded.
 *
 * WHY THE REFUSALS ARE SCREENS AND NOT REDIRECTS. Someone else's movement, or a
 * transfer leg, is a dead end with an explanation — not a bounce to /app. A redirect
 * would leave a person pressing the same link and landing on the dashboard with no
 * idea why, which is the same failure mode as sending an authenticated non-member to
 * /login: the app looks broken instead of answering.
 */
export default async function EditMovementPage({
  params,
}: {
  // A Promise since Next 15 (this repo is on 15.5.21), the same shape reportes
  // already uses for searchParams. Reading it without awaiting throws.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [entry, { user }] = await Promise.all([
    resolveCurrentWorkspace(),
    getAuthenticatedUser(),
  ]);

  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const movement = await new SupabaseTransactionAdapter().findEditable(
    entry.value.workspaceId,
    id,
    user?.id ?? "",
  );

  if (!movement.ok) {
    // No such movement in this space is a genuine 404 — including the case where it
    // belongs to a space the person is not in, which must not read differently.
    if (movement.error.kind === "UnknownReference") notFound();

    const message =
      movement.error.kind === "TransferNotEditable"
        ? "Una transferencia no se edita por separado: sus dos lados tienen que seguir coincidiendo. Elimínala desde el inicio y regístrala de nuevo."
        : movement.error.kind === "NotPermitted"
          ? "Solo puedes editar los movimientos que registraste. Este lo registró otra persona del espacio."
          : "No pudimos abrir este movimiento. Intenta de nuevo en unos minutos.";

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground mb-4 text-sm transition-colors"
        >
          ← Volver
        </Link>

        <h1 className="text-foreground mb-4 text-2xl font-semibold">
          Editar movimiento
        </h1>

        <p
          role="alert"
          className="bg-muted text-muted-foreground rounded-lg px-4 py-3 text-sm leading-relaxed"
        >
          {message}
        </p>
      </main>
    );
  }

  const [accounts, categories] = await Promise.all([
    new SupabaseAccountAdapter().listByWorkspace(entry.value.workspaceId),
    new SupabaseCategoryAdapter().listByWorkspace(entry.value.workspaceId),
  ]);

  if (!accounts.ok || accounts.value.length === 0) {
    redirect("/app");
  }

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
        Editar movimiento
      </h1>

      <OfflineTransactionForm
        action={editMovementAction}
        accounts={accounts.value}
        categories={categories.ok ? categories.value : []}
        currencyLabel="soles"
        today={today}
        workspaceId={entry.value.workspaceId}
        submitLabel="Guardar cambios"
        /*
          The row's version as of THIS render. A correction made offline lands whatever
          happened meanwhile — last write wins — and this is what lets the sync say so
          instead of overwriting in silence.
        */
        baseUpdatedAt={movement.value.updatedAt}
        initial={{
          id: movement.value.id,
          kind: movement.value.kind,
          // Formatted, not divided: the round trip has to be exact, or saving an
          // untouched form would change the amount.
          amount: formatMinorUnitsForInput(
            movement.value.baseAmountMinorUnits,
            MINOR_UNIT_EXPONENT,
          ),
          accountId: movement.value.accountId,
          categoryId: movement.value.categoryId,
          occurredOn: movement.value.occurredOn,
          note: movement.value.note,
        }}
      />
    </main>
  );
}
