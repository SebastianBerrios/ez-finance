import type { Metadata } from "next";
import Link from "next/link";

import { changePasswordAction } from "@/app/(app)/actions/change-password.action";
import { ChangePasswordForm } from "@/modules/auth/ui/components/change-password-form";
import { ThemeToggle } from "@shared/ui/theme-toggle";

export const metadata: Metadata = {
  title: "Cambiar contraseña — ez finance",
};

export default function ChangePasswordPage() {
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
            Cambiar contraseña
          </span>
        </div>
        <ThemeToggle />
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-sm px-4 py-8">
        <h1 className="text-foreground mb-2 text-xl font-bold">
          Cambiar contraseña
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Las otras sesiones activas serán cerradas al cambiar tu contraseña.
        </p>
        <ChangePasswordForm action={changePasswordAction} />
      </div>
    </main>
  );
}
