import type { Metadata } from "next";

import { IncomeForm } from "@/modules/budget/ui/components/income-form";

import { saveIncomeAction } from "./save-income.action";

export const metadata: Metadata = {
  title: "Tu ingreso — ez finance",
};

export default function OnboardingIncomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-muted-foreground text-sm">Paso 4 de 5</p>

      <h1 className="text-foreground mt-2 text-2xl font-semibold">
        ¿Cuánto esperas recibir este mes?
      </h1>

      <p className="text-muted-foreground mt-2 mb-6 text-sm leading-relaxed">
        Es la base del cálculo: tus tres cubos se miden contra este monto.
      </p>

      <IncomeForm action={saveIncomeAction} currencyLabel="soles" />
    </div>
  );
}
