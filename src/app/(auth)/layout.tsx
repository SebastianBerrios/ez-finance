import type { ReactNode } from "react";

import { ThemeToggle } from "@shared/ui/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-8">
      {/* Theme toggle in top-right corner */}
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>

      {/* Brand mark */}
      <div className="mb-8 text-center">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          ez finance
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">Tus finanzas, claras.</p>
      </div>

      {/* Auth card */}
      <div className="bg-card border-border w-full max-w-sm rounded-2xl border p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
