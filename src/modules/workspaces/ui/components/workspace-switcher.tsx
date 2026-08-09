"use client";

import { useActionState } from "react";

import type { WorkspaceSummary } from "@/modules/workspaces/application/ports/workspace-port";
import {
  type DeleteWorkspaceState,
  type WorkspaceLifecycleState,
  WorkspaceAdmin,
} from "@/modules/workspaces/ui/components/workspace-admin";
import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";
import type { RenameState } from "@shared/ui/rename-inline";

export interface SwitchWorkspaceState {
  error?: string;
}

export interface CreateWorkspaceState {
  error?: string;
  created?: string;
}

type SwitchActionFn = (
  prev: SwitchWorkspaceState,
  formData: FormData,
) => Promise<SwitchWorkspaceState>;

type CreateActionFn = (
  prev: CreateWorkspaceState,
  formData: FormData,
) => Promise<CreateWorkspaceState>;

interface WorkspaceSwitcherProps {
  switchAction: SwitchActionFn;
  createAction: CreateActionFn;
  renameAction: (prev: RenameState, formData: FormData) => Promise<RenameState>;
  lifecycleAction: (
    prev: WorkspaceLifecycleState,
    formData: FormData,
  ) => Promise<WorkspaceLifecycleState>;
  deleteAction: (
    prev: DeleteWorkspaceState,
    formData: FormData,
  ) => Promise<DeleteWorkspaceState>;
  workspaces: readonly WorkspaceSummary[];
  currentWorkspaceId: string;
}

const switchInitial: SwitchWorkspaceState = {};
const createInitial: CreateWorkspaceState = {};

const ROLE_LABEL: Readonly<Record<string, string>> = {
  owner: "Propietario",
  admin: "Administrador",
  member: "Miembro",
  observer: "Observador",
};

/**
 * Choose which workspace you are looking at, and make new ones.
 *
 * THE ROLE IS SHOWN even though every space here is currently yours and owned. It
 * costs one line now and stops being decoration the moment invitations exist — at
 * which point "why can I not add a category here?" is answered on the screen where you
 * picked the space, rather than by an error somewhere else.
 *
 * The personal space is labelled rather than hidden. It is the one the wizard
 * configured and the one everything falls back to, so it should be recognisable.
 */
export function WorkspaceSwitcher({
  switchAction,
  createAction,
  renameAction,
  lifecycleAction,
  deleteAction,
  workspaces,
  currentWorkspaceId,
}: WorkspaceSwitcherProps) {
  const [switchState, switchFormAction, isSwitching] = useActionState(
    switchAction,
    switchInitial,
  );
  const [createState, createFormAction, isCreating] = useActionState(
    createAction,
    createInitial,
  );

  return (
    <div className="flex flex-col gap-6">
      {switchState.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {switchState.error}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {workspaces.map((workspace) => {
          const isCurrent = workspace.id === currentWorkspaceId;

          return (
            <li
              key={workspace.id}
              className={
                isCurrent
                  ? "border-primary bg-primary/5 rounded-md border px-3 py-3"
                  : workspace.archived
                    ? "border-border/60 rounded-md border border-dashed px-3 py-3"
                    : "border-border rounded-md border px-3 py-3"
              }
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-foreground text-sm">
                    {workspace.name}
                    {workspace.type === "personal" && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        personal
                      </span>
                    )}
                    {/*
                    Labelled, not hidden. An archived space keeps its reports and
                    is still worth opening; what it does not accept is new rows.
                  */}
                    {workspace.archived && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        solo lectura
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {ROLE_LABEL[workspace.role] ?? workspace.role}
                  </span>
                </span>

                {isCurrent ? (
                  <span className="text-muted-foreground text-xs">
                    Estás aquí
                  </span>
                ) : (
                  <form action={switchFormAction}>
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={workspace.id}
                    />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      disabled={isSwitching}
                      aria-label={`Cambiar a ${workspace.name}`}
                    >
                      Cambiar
                    </Button>
                  </form>
                )}
              </div>

              {(workspace.role === "owner" || workspace.role === "admin") && (
                <WorkspaceAdmin
                  workspace={workspace}
                  renameAction={renameAction}
                  lifecycleAction={lifecycleAction}
                  deleteAction={deleteAction}
                />
              )}
            </li>
          );
        })}
      </ul>

      <details className="border-border rounded-lg border">
        <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
          Crear un espacio
        </summary>

        <form
          action={createFormAction}
          noValidate
          className="flex flex-col gap-4 px-4 pt-2 pb-4"
        >
          {createState.error !== undefined && (
            <div
              role="alert"
              aria-live="assertive"
              className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
            >
              {createState.error}
            </div>
          )}

          {createState.created !== undefined && (
            <p aria-live="polite" className="text-muted-foreground text-sm">
              Creamos «{createState.created}» y te llevamos ahí.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-name">Nombre</Label>
            <Input
              id="workspace-name"
              name="name"
              type="text"
              required
              maxLength={80}
              placeholder="Negocio"
            />
            <p className="text-muted-foreground text-xs">
              Empieza vacío, con las categorías de siempre y sin cuentas. Su
              presupuesto es independiente del de este espacio.
            </p>
          </div>

          <Button
            type="submit"
            variant="outline"
            disabled={isCreating}
            className="w-full"
          >
            {isCreating ? "Creando…" : "Crear"}
          </Button>
        </form>
      </details>
    </div>
  );
}
