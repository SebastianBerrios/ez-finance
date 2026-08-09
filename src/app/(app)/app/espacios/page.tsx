import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveCurrentWorkspace } from "@/app/(app)/current-workspace";
import { SupabaseWorkspaceAdapter } from "@/modules/workspaces/infrastructure/supabase-workspace-adapter";
import { WorkspaceSwitcher } from "@/modules/workspaces/ui/components/workspace-switcher";

import { createWorkspaceAction } from "./create-workspace.action";
import { deleteWorkspaceAction } from "./delete-workspace.action";
import { renameWorkspaceAction } from "./rename-workspace.action";
import { switchWorkspaceAction } from "./switch-workspace.action";
import { workspaceLifecycleAction } from "./workspace-lifecycle.action";

export const metadata: Metadata = {
  title: "Espacios — ez finance",
};

/**
 * Choose or create a workspace.
 *
 * WHAT A SECOND SPACE IS FOR, before invitations exist: keeping money that should not
 * be averaged together apart. A freelancer's business income and their household
 * budget answer different questions, and a single 50/30/20 over both answers neither.
 * Each space has its own accounts, categories, budget and history.
 *
 * Sharing one with another person is Fase 3's remaining half and is NOT built. The
 * role shown next to each space is already real — the RLS matrix has enforced it since
 * the schema was written — it simply says "Propietario" for everything until then.
 */
export default async function WorkspacesPage() {
  const current = await resolveCurrentWorkspace();

  if (!current.ok || current.value.kind !== "READY") {
    redirect("/app");
  }

  const workspaces = await new SupabaseWorkspaceAdapter().listForCurrentUser();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-bold">Espacios</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Cada espacio tiene sus propias cuentas, categorías y presupuesto.
          Sirve para separar lo que no debería promediarse junto.
        </p>
      </div>

      {!workspaces.ok ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          No pudimos cargar tus espacios. Intenta de nuevo en unos minutos.
        </div>
      ) : (
        <WorkspaceSwitcher
          switchAction={switchWorkspaceAction}
          createAction={createWorkspaceAction}
          renameAction={renameWorkspaceAction}
          lifecycleAction={workspaceLifecycleAction}
          deleteAction={deleteWorkspaceAction}
          workspaces={workspaces.value}
          currentWorkspaceId={current.value.workspaceId}
        />
      )}
    </main>
  );
}
