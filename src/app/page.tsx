import { MoneyDisplay } from "@shared/ui/money-display";
import { ThemeToggle } from "@shared/ui/theme-toggle";

export default function Home() {
  return (
    <main className="flex min-h-screen w-full max-w-full flex-col items-center justify-center overflow-x-hidden px-4 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            ez finance
          </h1>
          <p className="text-lg text-muted-foreground">
            Tus finanzas, claras.
          </p>
        </div>

        <MoneyDisplay amount={1234.56} currency="EUR" variant="income" />

        <ThemeToggle />
      </div>
    </main>
  );
}
