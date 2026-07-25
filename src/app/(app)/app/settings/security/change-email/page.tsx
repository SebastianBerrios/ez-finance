import type { Metadata } from "next";
import Link from "next/link";

import { changeEmailAction } from "@/app/(app)/actions/change-email.action";
import { ChangeEmailForm } from "@/modules/auth/ui/components/change-email-form";
import { ThemeToggle } from "@shared/ui/theme-toggle";

export const metadata: Metadata = {
  title: "Cambiar correo — ez finance",
};

// NOTE: actual verification email delivery is deferred until Resend SMTP is
// configured. The ChangeEmailForm shows a success message with instructions;
// the email will only arrive once Resend is connected.
export default function ChangeEmailPage() {
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
            Cambiar correo
          </span>
        </div>
        <ThemeToggle />
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-sm px-4 py-8">
        <h1 className="text-foreground mb-2 text-xl font-bold">
          Cambiar correo electrónico
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Te enviaremos un enlace de verificación a tu nuevo correo.
        </p>
        <ChangeEmailForm action={changeEmailAction} />
      </div>
    </main>
  );
}
