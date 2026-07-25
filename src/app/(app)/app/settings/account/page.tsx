import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { cancelAccountDeletionAction } from "@/app/(app)/actions/cancel-account-deletion.action";
import { requestAccountDeletionAction } from "@/app/(app)/actions/request-account-deletion.action";
import { getAccountDeletionStatus } from "@/modules/auth/application/get-account-deletion-status";
import { SupabaseDeletionAdapter } from "@/modules/auth/infrastructure/supabase-deletion-adapter";
import { CancelDeletionForm } from "@/modules/auth/ui/components/cancel-deletion-form";
import { DeleteAccountForm } from "@/modules/auth/ui/components/delete-account-form";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { ThemeToggle } from "@shared/ui/theme-toggle";

export const metadata: Metadata = {
  title: "Datos y cuenta — ez finance",
};

// Formatted on the server so the date cannot render differently in the client
// locale. UTC keeps it deterministic until per-user timezones exist.
const deadlineFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "UTC",
});

interface AccountPageProps {
  searchParams: Promise<{ export?: string }>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const { export: exportFlag } = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const status = await getAccountDeletionStatus(
    { userId: user.id },
    { deletion: new SupabaseDeletionAdapter() },
  );

  const pendingGrace =
    status.ok && status.value.state === "GRACE_PERIOD"
      ? status.value.grace
      : undefined;

  return (
    <main className="flex min-h-screen w-full flex-col">
      {/* Top bar */}
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Link
            href="/app/settings"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            ← Configuración
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground text-sm font-semibold">
            Datos y cuenta
          </span>
        </div>
        <ThemeToggle />
      </header>

      {/* Content */}
      <div className="mx-auto flex w-full max-w-sm flex-col gap-8 px-4 py-8">
        {exportFlag === "error" && (
          <div
            role="alert"
            className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
          >
            No pudimos preparar tu exportación. Intentá de nuevo en unos
            minutos.
          </div>
        )}

        <section>
          <h1 className="text-foreground mb-2 text-xl font-bold">
            Exportar mis datos
          </h1>
          <p className="text-muted-foreground mb-4 text-sm">
            Descargá un archivo ZIP con tu perfil, tus espacios y tus
            membresías, en formato JSON y CSV.
          </p>
          <a
            href="/app/settings/account/export"
            className="border-border hover:bg-accent inline-flex h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors"
          >
            Descargar mis datos
          </a>
        </section>

        <section>
          <h2 className="text-foreground mb-2 text-xl font-bold">
            Eliminar mi cuenta
          </h2>

          {/* FAIL CLOSED. When the lifecycle read fails we know nothing: the
              account may already be inside the grace window. Rendering the
              delete form would offer deletion to someone who already requested
              it, while the cancel button — their way out — stays hidden. So
              neither form renders; only the error and a way to retry. */}
          {!status.ok ? (
            <>
              <p
                role="alert"
                className="bg-destructive/10 text-destructive mb-4 rounded-lg px-4 py-3 text-sm"
              >
                No pudimos leer el estado de tu cuenta, así que no mostramos
                estas opciones para no hacer algo que no querías. Volvé a
                intentarlo en unos minutos.
              </p>
              <a
                href="/app/settings/account"
                className="border-border hover:bg-accent inline-flex h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors"
              >
                Reintentar
              </a>
            </>
          ) : pendingGrace ? (
            <CancelDeletionForm
              action={cancelAccountDeletionAction}
              deadlineLabel={deadlineFormatter.format(pendingGrace.endsAt)}
            />
          ) : (
            <>
              <p className="text-muted-foreground mb-4 text-sm">
                Eliminamos tus datos de ez finance. Tu cuenta de acceso sigue
                existiendo para otras aplicaciones que la usen.
              </p>
              <DeleteAccountForm action={requestAccountDeletionAction} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
