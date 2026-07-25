"use client";

import { useActionState } from "react";

import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";

export interface ProfileFormState {
  success?: boolean;
  error?: string;
}

type ProfileActionFn = (
  prev: ProfileFormState,
  formData: FormData,
) => Promise<ProfileFormState>;

interface ProfileFormProps {
  action: ProfileActionFn;
  initialDisplayName?: string;
}

const initialState: ProfileFormState = {};

export function ProfileForm({ action, initialDisplayName }: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.success && (
        <div
          role="status"
          aria-live="polite"
          className="bg-muted rounded-lg px-4 py-3 text-sm"
        >
          Perfil actualizado correctamente.
        </div>
      )}

      {state.error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-displayName">Nombre para mostrar</Label>
        <Input
          id="profile-displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          placeholder="Tu nombre"
          defaultValue={initialDisplayName ?? ""}
          disabled={isPending}
        />
      </div>

      {/* Avatar upload is DEFERRED — no storage bucket provisioned yet.
          TODO: add file input here once the 'avatars' bucket is created. */}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
