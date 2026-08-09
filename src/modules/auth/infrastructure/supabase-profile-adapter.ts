// supabase-profile-adapter.ts — implements ProfilePort
// Reads/writes ez_finance.profiles for the authenticated user.
import {
  type AvatarFile,
  type ProfilePort,
  type UserProfilePatch,
} from "@/modules/auth/application/ports/profile-port";
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type UserProfile } from "@/modules/auth/domain/user-profile";
import { type Result, err, ok } from "@/shared/domain/result";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

import { mapSupabaseError } from "./error-map";

// Row shape returned from Supabase PostgREST for ez_finance.profiles
interface ProfileRow {
  id: string;
  display_name: string;
  photo_url: string | null;
  language: "es" | "en";
  default_currency: string;
}

function rowToProfile(row: ProfileRow): UserProfile {
  const profile: UserProfile = {
    _brand: "UserProfile",
    displayName: row.display_name,
    language: row.language,
    defaultCurrency: row.default_currency.trim(),
  };
  // exactOptionalPropertyTypes: only set photoUrl if the value is non-null
  if (row.photo_url !== null && row.photo_url !== undefined) {
    return { ...profile, photoUrl: row.photo_url };
  }
  return profile;
}

export class SupabaseProfileAdapter implements ProfilePort {
  async getProfile(userId: string): Promise<Result<UserProfile, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase
        .schema("ez_finance")
        .from("profiles")
        .select("id, display_name, photo_url, language, default_currency")
        .eq("id", userId)
        .single<ProfileRow>();

      if (error) return err(mapSupabaseError(error));
      if (!data) return err({ kind: "Unavailable" });

      return ok(rowToProfile(data));
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  async updateProfile(
    userId: string,
    patch: UserProfilePatch,
  ): Promise<Result<UserProfile, AuthError>> {
    try {
      const supabase = await createServerClient();

      const updatePayload: Record<string, unknown> = {};
      if (patch.displayName !== undefined)
        updatePayload["display_name"] = patch.displayName;
      if (patch.photoUrl !== undefined)
        updatePayload["photo_url"] = patch.photoUrl;
      if (patch.language !== undefined)
        updatePayload["language"] = patch.language;
      if (patch.defaultCurrency !== undefined)
        updatePayload["default_currency"] = patch.defaultCurrency.toUpperCase();

      const { data, error } = await supabase
        .schema("ez_finance")
        .from("profiles")
        .update(updatePayload)
        .eq("id", userId)
        .select("id, display_name, photo_url, language, default_currency")
        .single<ProfileRow>();

      if (error) return err(mapSupabaseError(error));
      if (!data) return err({ kind: "Unavailable" });

      return ok(rowToProfile(data));
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  async setPreferences(
    userId: string,
    prefs: { language?: "es" | "en"; defaultCurrency?: string },
  ): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();

      const updatePayload: Record<string, unknown> = {};
      if (prefs.language !== undefined)
        updatePayload["language"] = prefs.language;
      if (prefs.defaultCurrency !== undefined)
        updatePayload["default_currency"] = prefs.defaultCurrency.toUpperCase();

      const { error } = await supabase
        .schema("ez_finance")
        .from("profiles")
        .update(updatePayload)
        .eq("id", userId);

      if (error) return err(mapSupabaseError(error));
      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  async uploadAvatar(
    userId: string,
    file: AvatarFile,
  ): Promise<Result<{ photoUrl: string }, AuthError>> {
    try {
      const supabase = await createServerClient();

      const ext = file.mime.split("/")[1] ?? "jpg";
      const path = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file.bytes, {
          contentType: file.mime,
          upsert: true, // requires INSERT + SELECT + UPDATE policies per skill
        });

      if (uploadError) return err(mapSupabaseError(uploadError));

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);

      const photoUrl = urlData.publicUrl;

      // Persist the URL back to the profile
      const updateResult = await this.updateProfile(userId, { photoUrl });
      if (!updateResult.ok) return err(updateResult.error);

      return ok({ photoUrl });
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }
}
