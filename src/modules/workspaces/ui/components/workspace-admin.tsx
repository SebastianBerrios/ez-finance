"use client";

import { useActionState } from "react";

import type { WorkspaceSummary } from "@/modules/workspaces/application/ports/workspace-port";
import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";
import { type RenameState, RenameInline } from "@shared/ui/rename-inline";

export interface WorkspaceLifecycleState {
  error?: string;
  archived?: string;
  restored?: string;
}

export interface DeleteWorkspaceState {
  error?: string;
}

type LifecycleActionFn = (
  prev: WorkspaceLifecycleState,
  formData: FormData,
) => Promise<WorkspaceLifecycleState>;

type DeleteActionFn = (
  prev: DeleteWorkspaceState,
  formData: FormData,
) => Promise<DeleteWorkspaceState>;

type RenameActionFn = (
  prev: RenameState,
  formData: FormData,
) => Promise<RenameState>;

interface WorkspaceAdminProps {
  workspace: WorkspaceSummary;
  renameAction: RenameActionFn;
  lifecycleAction: LifecycleActionFn;
  deleteAction: DeleteActionFn;
}

const lifecycleInitial: WorkspaceLifecycleState = {};
const deleteInitial: DeleteWorkspaceState = {};

/**
 * What the OWNER can do to a workspace, collapsed behind one summary.
 *
 * COLLAPSED FOR THE SAME REASON RenameInline IS. This is a list people come to in
 * order to SWITCH spaces; three more controls per row turn scanning it into
 * navigating a form, and one of those controls ends a workspace. Archiving and
 * deleting are things you do once, so they cost a click to reach.
 *
 * WHAT IS OFFERED IS WHAT WILL WORK. Every rule below is enforced in the database
 * (20260807210000) and the server refuses regardless — but a button that explains
 * itself beats a button that produces an error, so:
 *
 *  - the personal space gets NO archive and NO delete. It is bootstrap()'s anchor;
 *    deleting it would make the next sign-in create a second one and show it as
 *    home. It is explained rather than silently missing.
 *  - an archived space gets no rename, because archived means read-only and a name
 *    is configuration.
 *  - delete appears only once archived, because that is the required order, and it
 *    asks for the name because the RPC demands it.
 */
export function WorkspaceAdmin({
  workspace,
  renameAction,
  lifecycleAction,
  deleteAction,
}: WorkspaceAdminProps) {
  const [lifecycleState, lifecycleFormAction, isBusy] = useActionState(
    lifecycleAction,
    lifecycleInitial,
  );
  const [deleteState, deleteFormAction, isDeleting] = useActionState(
    deleteAction,
    deleteInitial,
  );

  const isPersonal = workspace.type === "personal";
  // Spec §4: renaming is configuration (admin row); archiving and deleting the
  // workspace are the owner's alone. The RPCs enforce both; this only decides
  // which controls are worth showing.
  const isOwner = workspace.role === "owner";

  return (
    <details className="border-border/60 mt-2 rounded-md border">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-2 text-xs">
        Administrar
      </summary>

      <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
        {lifecycleState.error !== undefined && (
          <div
            role="alert"
            aria-live="assertive"
            className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs"
          >
            {lifecycleState.error}
          </div>
        )}

        {lifecycleState.archived !== undefined && (
          <p aria-live="polite" className="text-muted-foreground text-xs">
            «{lifecycleState.archived}» quedó en solo lectura. Sus reportes
            siguen ahí; no acepta movimientos nuevos.
          </p>
        )}

        {lifecycleState.restored !== undefined && (
          <p aria-live="polite" className="text-muted-foreground text-xs">
            «{lifecycleState.restored}» vuelve a aceptar movimientos.
          </p>
        )}

        {isPersonal && isOwner ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Tu espacio personal no se archiva ni se elimina: es el que la app
            usa como punto de partida. Puedes cambiarle el nombre.
          </p>
        ) : null}

        {!workspace.archived && (
          <div className="flex items-center gap-1">
            <RenameInline
              action={renameAction}
              idField="workspaceId"
              id={workspace.id}
              currentName={workspace.name}
              maxLength={80}
              thing="espacio"
            />
          </div>
        )}

        {!isPersonal && isOwner && (
          <form action={lifecycleFormAction}>
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input type="hidden" name="workspaceName" value={workspace.name} />
            <input
              type="hidden"
              name="intent"
              value={workspace.archived ? "restore" : "archive"}
            />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isBusy}
              aria-label={`${workspace.archived ? "Restaurar" : "Archivar"} espacio ${workspace.name}`}
            >
              {workspace.archived ? "Restaurar" : "Archivar"}
            </Button>
          </form>
        )}

        {/*
          Only once archived. Nested one level deeper than everything else on
          purpose: this is the only control in the app that ends a workspace, and
          the extra click is the point.
        */}
        {!isPersonal && isOwner && workspace.archived && (
          <details className="border-destructive/40 rounded-md border">
            <summary className="text-destructive cursor-pointer px-3 py-2 text-xs">
              Eliminar «{workspace.name}»
            </summary>

            <form
              action={deleteFormAction}
              noValidate
              className="flex flex-col gap-3 px-3 pt-1 pb-3"
            >
              {deleteState.error !== undefined && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs"
                >
                  {deleteState.error}
                </div>
              )}

              <p className="text-muted-foreground text-xs leading-relaxed">
                Sus cuentas, categorías, movimientos y reportes dejan de estar
                disponibles. Escribe{" "}
                <span className="text-foreground font-medium">
                  {workspace.name}
                </span>{" "}
                para confirmar.
              </p>

              <input type="hidden" name="workspaceId" value={workspace.id} />

              <div className="flex flex-col gap-2">
                <Label htmlFor={`confirm-${workspace.id}`}>
                  Nombre del espacio
                </Label>
                <Input
                  id={`confirm-${workspace.id}`}
                  name="confirmName"
                  type="text"
                  required
                  autoComplete="off"
                  maxLength={80}
                />
              </div>

              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={isDeleting}
                aria-label={`Confirmar eliminación de ${workspace.name}`}
              >
                {isDeleting ? "Eliminando…" : "Eliminar definitivamente"}
              </Button>
            </form>
          </details>
        )}
      </div>
    </details>
  );
}
