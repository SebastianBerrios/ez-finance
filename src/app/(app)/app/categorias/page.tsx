import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseCategoryAdapter } from "@/modules/categories/infrastructure/supabase-category-adapter";
import { CategoryCreator } from "@/modules/categories/ui/components/category-creator";
import { CategoryManager } from "@/modules/categories/ui/components/category-manager";

import { archiveCategoryAction } from "./archive-category.action";
import { createCategoryAction } from "./create-category.action";
import { renameCategoryAction } from "./rename-category.action";
import { restoreCategoryAction } from "./restore-category.action";

export const metadata: Metadata = {
  title: "Categorías — ez finance",
};

/**
 * Manage categories.
 *
 * WHY THIS PAGE EXISTS. Categories could only be created during setup, and setup
 * cannot be re-entered once a workspace is configured — the wizard root redirects
 * to /app. So the answer to "where do I add a category?" was nowhere, and the
 * eleven seeded ones were permanent. Everything here reuses createCategory and
 * archiveMany; what was missing was a door.
 */
export default async function CategoriesPage() {
  const entry = await resolveCurrentWorkspace();
  if (!entry.ok || entry.value.kind !== "READY") {
    redirect("/app");
  }

  const listed = await new SupabaseCategoryAdapter().listByWorkspace(
    entry.value.workspaceId,
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-bold">Categorías</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Cada categoría pertenece a uno de los tres cubos, y eso decide contra
          qué parte de tu ingreso se mide lo que gastas en ella.
        </p>
      </div>

      {!listed.ok ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos cargar tus categorías. Intenta de nuevo en unos minutos.
        </div>
      ) : (
        <>
          <CategoryManager
            action={archiveCategoryAction}
            renameAction={renameCategoryAction}
            restoreAction={restoreCategoryAction}
            categories={listed.value}
          />

          <CategoryCreator action={createCategoryAction} />
        </>
      )}
    </main>
  );
}
