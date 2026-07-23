import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type UserProfile } from "@/modules/auth/domain/user-profile";
import { type Result } from "@/shared/domain/result";

export interface AvatarFile {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly size: number;
}

// Mutable patch used by updateProfile — only the writeable fields the adapter accepts
export interface UserProfilePatch {
  displayName?: string;
  photoUrl?: string;
  language?: "es" | "en";
  defaultCurrency?: string;
}

export interface ProfilePort {
  getProfile(userId: string): Promise<Result<UserProfile, AuthError>>;
  updateProfile(
    userId: string,
    patch: UserProfilePatch,
  ): Promise<Result<UserProfile, AuthError>>;
  setPreferences(
    userId: string,
    prefs: { language?: "es" | "en"; defaultCurrency?: string },
  ): Promise<Result<void, AuthError>>;
  uploadAvatar(
    userId: string,
    file: AvatarFile,
  ): Promise<Result<{ photoUrl: string }, AuthError>>;
}
