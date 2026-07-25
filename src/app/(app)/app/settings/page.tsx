import type { Metadata } from "next";
import Link from "next/link";

import { logoutAction } from "@/app/(app)/actions/logout.action";
import { LogoutButton } from "@/modules/auth/ui/components/logout-button";
import { ThemeToggle } from "@shared/ui/theme-toggle";

export const metadata: Metadata = {
  title: "Configuración — ez finance",
};

const settingsSections = [
  {
    title: "Cuenta",
    items: [
      {
        href: "/app/settings/profile",
        label: "Perfil",
        description: "Nombre para mostrar",
      },
      {
        href: "/app/settings/preferences",
        label: "Preferencias",
        description: "Idioma y moneda principal",
      },
    ],
  },
  {
    title: "Seguridad",
    items: [
      {
        href: "/app/settings/security/change-password",
        label: "Cambiar contraseña",
        description: "Actualizá tu contraseña",
      },
      {
        href: "/app/settings/security/change-email",
        label: "Cambiar correo",
        description: "Actualizá tu correo electrónico",
      },
    ],
  },
];

export default function SettingsPage() {
  return (
    <main className="flex min-h-screen w-full flex-col">
      {/* Top bar */}
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            ← Inicio
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground text-sm font-semibold">
            Configuración
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LogoutButton action={logoutAction} />
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-lg px-4 py-8">
        <h1 className="text-foreground mb-6 text-2xl font-bold">
          Configuración
        </h1>

        <div className="flex flex-col gap-6">
          {settingsSections.map((section) => (
            <section key={section.title}>
              <h2 className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-widest">
                {section.title}
              </h2>
              <div className="bg-card border-border rounded-xl border">
                {section.items.map((item, idx) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`hover:bg-accent flex items-center justify-between px-4 py-4 transition-colors ${
                      idx < section.items.length - 1
                        ? "border-border border-b"
                        : ""
                    }`}
                  >
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {item.label}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {item.description}
                      </p>
                    </div>
                    <span className="text-muted-foreground text-sm">›</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
