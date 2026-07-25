"use server";

import { setPreferences } from "@/modules/auth/application/set-preferences";
import { SupabaseProfileAdapter } from "@/modules/auth/infrastructure/supabase-profile-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface SetPreferencesState {
  success?: boolean;
  error?: string;
}

export async function setPreferencesAction(
  _prev: SetPreferencesState,
  formData: FormData,
): Promise<SetPreferencesState> {
  // server-auth-actions: always verify session server-side first.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sesión expirada. Por favor ingresá de nuevo." };
  }

  const languageRaw = formData.get("language") as string | null;
  const defaultCurrencyRaw = formData.get("defaultCurrency") as string | null;

  const safeLanguage: "es" | "en" | undefined =
    languageRaw === "es" || languageRaw === "en" ? languageRaw : undefined;
  const safeCurrency =
    defaultCurrencyRaw?.trim().length === 3
      ? defaultCurrencyRaw.trim()
      : undefined;

  const profile = new SupabaseProfileAdapter();

  // exactOptionalPropertyTypes: only include keys with defined values
  const input: Parameters<typeof setPreferences>[0] = { userId: user.id };
  if (safeLanguage !== undefined) input.language = safeLanguage;
  if (safeCurrency !== undefined) input.defaultCurrency = safeCurrency;

  const result = await setPreferences(input, { profile });

  if (!result.ok) {
    return { error: "No pudimos guardar tus preferencias. Intentá de nuevo." };
  }

  return { success: true };
}
