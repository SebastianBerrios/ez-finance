"use server";

import { editProfile } from "@/modules/auth/application/edit-profile";
import { SupabaseProfileAdapter } from "@/modules/auth/infrastructure/supabase-profile-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface EditProfileState {
  success?: boolean;
  error?: string;
}

export async function editProfileAction(
  _prev: EditProfileState,
  formData: FormData,
): Promise<EditProfileState> {
  // server-auth-actions: always verify session server-side first.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sesión expirada. Por favor ingresa de nuevo." };
  }

  const displayNameRaw = (formData.get("displayName") as string | null) ?? "";
  const displayName = displayNameRaw.trim();

  // Avatar upload is DEFERRED — no storage bucket provisioned yet.
  // TODO: implement avatar upload once the 'avatars' bucket is created.
  const profile = new SupabaseProfileAdapter();

  // exactOptionalPropertyTypes: build the input without undefined-valued keys
  const input: Parameters<typeof editProfile>[0] = displayName
    ? { userId: user.id, displayName }
    : { userId: user.id };

  const result = await editProfile(input, { profile });

  if (!result.ok) {
    return { error: "No pudimos actualizar tu perfil. Intentá de nuevo." };
  }

  return { success: true };
}
