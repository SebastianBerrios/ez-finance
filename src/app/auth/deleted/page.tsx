// auth/deleted — terminal notice for an account whose grace period ran out and
// whose ez finance data has been erased.
//
// WHY A PAGE AND NOT THE ROUTE HANDLER IT REPLACED: the handler was an
// unauthenticated-reachable GET that acknowledged the erasure and signed the
// caller out. A typed URL, a shared link, a crawler, the Back button or a
// cross-site `<img src="/auth/deleted">` all fired it — and for someone
// genuinely in the DELETED state that consumed the one-shot terminal notice
// without ever showing it. Reading is safe here; the destructive half lives
// behind a Server Action the person has to submit (Server Actions can write
// cookies, Server Components cannot, which is why the handler existed).
//
// WHY A READ FAILURE RENDERS INSTEAD OF REDIRECTING: the (app) layout sends
// DELETED users here, and this page used to "fail closed" by redirecting back
// to /app — which is wrapped by that same layout. A persistent RPC failure (a
// clobbered grant, a PostgREST schema-cache miss, a statement timeout) therefore
// gave every erased user ERR_TOO_MANY_REDIRECTS and no way into the app.
//
// This route is excluded from the middleware matcher (see src/middleware.ts):
// the middleware refreshes the session on the SAME response object, which would
// hand back a fresh cookie and undo the sign-out the action performs.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAccountDeletionStatus } from "@/modules/auth/application/get-account-deletion-status";
import { SupabaseDeletionAdapter } from "@/modules/auth/infrastructure/supabase-deletion-adapter";
import { DeletionNoticeForm } from "@/modules/auth/ui/components/deletion-notice-form";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";

import { acknowledgeDeletionAction } from "./acknowledge-deletion.action";

export const metadata: Metadata = {
  title: "Eliminamos tus datos — ez finance",
};

// It reads the session cookie on every request and must never be prerendered.
export const dynamic = "force-dynamic";

// UTC keeps it deterministic until per-user timezones exist.
const erasureFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "UTC",
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4 py-8">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <h1 className="text-foreground text-center text-xl font-semibold">
          Tu cuenta de ez finance
        </h1>
        {children}
      </div>
    </main>
  );
}

export default async function DeletedPage() {
  const { user } = await getAuthenticatedUser();

  // No session: nothing to announce and nothing to close.
  if (!user) {
    redirect("/login");
  }

  const status = await getAccountDeletionStatus(
    { userId: user.id },
    { deletion: new SupabaseDeletionAdapter() },
  );

  if (!status.ok) {
    // TERMINAL PAGE, NOT A REDIRECT. See the header: bouncing to /app lands
    // back here through the (app) layout, forever.
    console.error("[auth/deleted] lifecycle read failed:", status.error);

    return (
      <Shell>
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos leer el estado de tu cuenta, así que no hicimos nada.
          Volvé a intentarlo en unos minutos.
        </p>
        <Link
          href="/auth/deleted"
          className="border-border hover:bg-accent inline-flex h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors"
        >
          Reintentar
        </Link>
      </Shell>
    );
  }

  if (status.value.state !== "DELETED") {
    // A live account — ACTIVE, or still inside its grace window. Send it back
    // to the app with no message and no sign-out.
    redirect("/app");
  }

  const finalizedAt = status.value.finalizedAt;

  return (
    <Shell>
      <DeletionNoticeForm
        action={acknowledgeDeletionAction}
        {...(finalizedAt
          ? { erasedOnLabel: erasureFormatter.format(finalizedAt) }
          : {})}
      />
    </Shell>
  );
}
