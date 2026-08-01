import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { CategoryCreator } from "@/modules/categories/ui/components/category-creator";
import { CategoryPicker } from "@/modules/categories/ui/components/category-picker";

import { createCategoryAction } from "./create-category.action";
import { keepCategoriesAction } from "./keep-categories.action";

export const metadata: Metadata = {
  title: "Tus categorías — ez finance",
};

export default async function OnboardingCategoriesPage() {
  const entry = await bootstrapUserWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const listed = await new SupabaseCategoryAdapter().listByWorkspace(
    entry.value.workspaceId,
  );

  // A read failure must not strand the wizard. The categories were seeded by
  // bootstrap, so skipping ahead leaves a usable workspace; blocking here would
  // leave someone with an account and no way to finish.
  if (!listed.ok) {
    redirect("/onboarding/ingreso");
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-muted-foreground text-sm">Paso 3 de 4</p>

      <h1 className="text-foreground mt-2 text-2xl font-semibold">
        Estas son tus categorías
      </h1>

      <p className="text-muted-foreground mt-2 mb-6 text-sm leading-relaxed">
        Las preparamos para empezar rápido. Desmarca las que no vayas a usar, y
        agrega las que te falten.
      </p>

      <CategoryPicker action={keepCategoriesAction} categories={listed.value} />

      {/*
        BELOW the list and the Continuar button, because adding is the exception and
        continuing is the common case. The creator revalidates this route rather than
        navigating, so anything added appears in the list above, already checked.
      */}
      <CategoryCreator action={createCategoryAction} />
    </div>
  );
}
