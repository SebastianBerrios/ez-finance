import Link from "next/link";

import { fromMinorUnits } from "@shared/domain/money";
import { MoneyDisplay } from "@shared/ui/money-display";
import { ThemeToggle } from "@shared/ui/theme-toggle";

/**
 * 600000 minor units = S/ 6,000.00.
 *
 * PEN, not the EUR this page was scaffolded with in Fase 0. The app is soles-only
 * and every other screen renders es-PE, so a euro figure on the one page a stranger
 * sees first was the product contradicting itself before saying hello.
 */
const demoAmount = fromMinorUnits("PEN", 600000n);

export default function Home() {
  if (!demoAmount.ok) return null;

  return (
    <main className="flex min-h-screen w-full max-w-full flex-col items-center justify-center overflow-x-hidden px-4 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-foreground text-4xl font-bold tracking-tight">
            ez finance
          </h1>
          <p className="text-muted-foreground text-lg">Tus finanzas, claras.</p>
        </div>

        <MoneyDisplay amount={demoAmount.value} variant="income" />

        <p className="text-muted-foreground text-sm leading-relaxed">
          Reparte tu ingreso del mes en necesidades, deseos y ahorro, y mira en
          qué vas.
        </p>

        {/*
          THE WAY IN, which this page did not have. It was a Fase 0 scaffold — a
          heading, a demo amount and a theme toggle — so someone who reached the
          site had nowhere to click and no reason to believe there was an app
          behind it.
        */}
        <div className="flex w-full flex-col gap-3">
          <Link
            href="/register"
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center rounded-md px-4 py-3 text-sm font-medium transition-colors"
          >
            Crear cuenta
          </Link>

          <Link
            href="/login"
            className="border-border text-foreground hover:bg-muted/40 flex w-full items-center justify-center rounded-md border px-4 py-3 text-sm font-medium transition-colors"
          >
            Ya tengo cuenta
          </Link>
        </div>

        <ThemeToggle />
      </div>
    </main>
  );
}
