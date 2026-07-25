import Link from "next/link";

import { logoutAction } from "@/app/(app)/actions/logout.action";
import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseProfileAdapter } from "@/modules/auth/infrastructure/supabase-profile-adapter";
import { LogoutButton } from "@/modules/auth/ui/components/logout-button";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { ThemeToggle } from "@shared/ui/theme-toggle";

// Protected landing page — middleware guarantees user is authenticated.
// Bootstraps workspace idempotently, then shows a minimal authenticated view.
// Full dashboard is a later phase.
export default async function AppPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // bootstrapUserWorkspace is idempotent — safe to call on every load.
  await bootstrapUserWorkspace();

  const profileAdapter = new SupabaseProfileAdapter();
  const profileResult = user ? await profileAdapter.getProfile(user.id) : null;

  const displayName =
    profileResult?.ok === true
      ? profileResult.value.displayName
      : (user?.email ?? "Usuario");

  return (
    <main className="flex min-h-screen w-full flex-col">
      {/* Top bar */}
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <span className="text-foreground font-semibold">ez finance</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LogoutButton action={logoutAction} />
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="text-center">
          <p className="text-muted-foreground text-sm">Bienvenido,</p>
          <h2 className="text-foreground mt-1 text-2xl font-bold">{displayName}</h2>
        </div>

        <div className="bg-card border-border w-full max-w-sm rounded-xl border p-5">
          <p className="text-muted-foreground mb-1 text-xs uppercase tracking-widest">
            Espacio activo
          </p>
          <p className="text-foreground font-semibold">Personal</p>
        </div>

        <p className="text-muted-foreground max-w-sm text-center text-sm">
          El dashboard completo estará disponible próximamente.
        </p>

        {/* Settings navigation */}
        <Link
          href="/app/settings"
          className="border-border text-muted-foreground hover:text-foreground flex w-full max-w-sm items-center justify-between rounded-xl border px-5 py-4 transition-colors hover:bg-accent/50"
        >
          <span className="text-sm font-medium">Configuración</span>
          <span className="text-sm">›</span>
        </Link>
      </div>
    </main>
  );
}
