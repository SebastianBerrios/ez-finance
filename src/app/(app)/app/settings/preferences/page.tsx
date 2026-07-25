import type { Metadata } from "next";
import Link from "next/link";

import { setPreferencesAction } from "@/app/(app)/actions/set-preferences.action";
import { SupabaseProfileAdapter } from "@/modules/auth/infrastructure/supabase-profile-adapter";
import { PreferencesForm } from "@/modules/auth/ui/components/preferences-form";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { ThemeToggle } from "@shared/ui/theme-toggle";

export const metadata: Metadata = {
  title: "Preferencias — ez finance",
};

export default async function PreferencesSettingsPage() {
  // Read current preferences server-side — middleware guarantees authentication.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profileAdapter = new SupabaseProfileAdapter();
  const profileResult = user ? await profileAdapter.getProfile(user.id) : null;

  const currentLanguage =
    profileResult?.ok === true ? profileResult.value.language : "es";
  const currentCurrency =
    profileResult?.ok === true ? profileResult.value.defaultCurrency : "ARS";

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
            Preferencias
          </span>
        </div>
        <ThemeToggle />
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-sm px-4 py-8">
        <h1 className="text-foreground mb-6 text-xl font-bold">Preferencias</h1>
        <PreferencesForm
          action={setPreferencesAction}
          initialLanguage={currentLanguage}
          initialCurrency={currentCurrency}
        />
      </div>
    </main>
  );
}
