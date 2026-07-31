import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Configuración inicial — ez finance",
};

/**
 * Step 1 of the wizard: orientation.
 *
 * A page of prose earns its place here because the product's central rule is
 * counter-intuitive — the 50/30/20 is measured against the month's INCOME, not
 * against total spending. Someone expecting "what share of my spending was
 * needs?" reads the dashboard as broken. Said once, up front, it costs one screen.
 */
export default function OnboardingWelcomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-muted-foreground text-sm">Paso 1 de 5</p>

      <h1 className="text-foreground mt-2 text-2xl font-semibold">
        Vamos a dejar tu presupuesto listo
      </h1>

      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        ez finance usa el método{" "}
        <strong className="text-foreground">50/30/20</strong>: repartir tu
        ingreso del mes entre lo que necesitás, lo que querés y lo que ahorrás.
      </p>

      <div className="border-border bg-muted/30 mt-6 rounded-lg border p-4">
        <p className="text-foreground text-sm font-medium">
          Se mide sobre tu ingreso, no sobre tu gasto
        </p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          La pregunta que responde el panel es{" "}
          <em>«¿cuánto del 50 % para necesidades ya usé?»</em>, no «¿qué parte
          de mis gastos fue necesidad?». Por eso, si todavía no gastaste nada,
          tus tres cubos arrancan en 0 %.
        </p>
      </div>

      <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
        Son tres datos: una cuenta donde tenés tu dinero, tu ingreso del mes y
        cómo querés repartirlo. Se puede cambiar después.
      </p>

      <div className="mt-auto pt-8">
        <a
          href="/onboarding/cuenta"
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center rounded-md px-4 py-3 text-sm font-medium transition-colors"
        >
          Empezar
        </a>
      </div>
    </div>
  );
}
