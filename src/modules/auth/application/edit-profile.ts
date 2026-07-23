import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type UserProfile } from "@/modules/auth/domain/user-profile";
import { type Result } from "@/shared/domain/result";

import { type ProfilePort, type AvatarFile, type UserProfilePatch } from "./ports/profile-port";

interface EditProfileInput {
  userId: string;
  displayName?: string;
  avatar?: AvatarFile;
}

interface EditProfileDeps {
  profile: ProfilePort;
}

export async function editProfile(
  input: EditProfileInput,
  deps: EditProfileDeps,
): Promise<Result<UserProfile, AuthError>> {
  if (input.avatar) {
    const avatarResult = await deps.profile.uploadAvatar(
      input.userId,
      input.avatar,
    );
    if (!avatarResult.ok) return avatarResult;
  }

  const patch: UserProfilePatch = {};
  if (input.displayName !== undefined) patch.displayName = input.displayName;

  return deps.profile.updateProfile(input.userId, patch);
}
