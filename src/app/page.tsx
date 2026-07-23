import { fromMinorUnits } from "@shared/domain/money";
import { MoneyDisplay } from "@shared/ui/money-display";
import { ThemeToggle } from "@shared/ui/theme-toggle";

// 123456 minor units = 1234.56 EUR
const demoAmount = fromMinorUnits("EUR", 123456n);

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

        <ThemeToggle />
      </div>
    </main>
  );
}
