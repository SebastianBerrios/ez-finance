import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountForm } from "@/modules/accounts/ui/components/account-form";
import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { readOnboardingStatus } from "@/modules/onboarding/infrastructure/onboarding-status";

import { createAccountAction } from "./create-account.action";

export const metadata: Metadata = {
  title: "Tu primera cuenta — ez finance",
};

export default async function OnboardingAccountPage() {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  // An account already exists, so the base currency is already fixed and this step
  // has nothing left to ask. Skipping forward beats rendering a form whose only
  // outcome would be a second account nobody asked for.
  const status = await readOnboardingStatus(entry.value.workspaceId);
  if (status.hasAccount) {
    redirect("/onboarding/categorias");
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-muted-foreground text-sm">Paso 2 de 4</p>

      <h1 className="text-foreground mt-2 text-2xl font-semibold">
        ¿Dónde tienes tu dinero?
      </h1>

      <p className="text-muted-foreground mt-2 mb-6 text-sm leading-relaxed">
        Empieza con una cuenta. Puedes agregar las demás cuando quieras.
      </p>

      <AccountForm action={createAccountAction} currencyLabel="soles" />
    </div>
  );
}
