import type { Metadata } from "next";
import Link from "next/link";

import { editProfileAction } from "@/app/(app)/actions/edit-profile.action";
import { SupabaseProfileAdapter } from "@/modules/auth/infrastructure/supabase-profile-adapter";
import { ProfileForm } from "@/modules/auth/ui/components/profile-form";
import { createServerClient } from "@/shared/infrastructure/supabase/server";
import { ThemeToggle } from "@shared/ui/theme-toggle";

export const metadata: Metadata = {
  title: "Perfil — ez finance",
};

export default async function ProfileSettingsPage() {
  // Read current profile server-side — middleware guarantees authentication.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profileAdapter = new SupabaseProfileAdapter();
  const profileResult = user ? await profileAdapter.getProfile(user.id) : null;
  const currentDisplayName =
    profileResult?.ok === true ? profileResult.value.displayName : "";

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
          <span className="text-foreground text-sm font-semibold">Perfil</span>
        </div>
        <ThemeToggle />
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-sm px-4 py-8">
        <h1 className="text-foreground mb-6 text-xl font-bold">Perfil</h1>
        <ProfileForm
          action={editProfileAction}
          initialDisplayName={currentDisplayName}
        />
      </div>
    </main>
  );
}
