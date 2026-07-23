import { type Result, err, ok } from "@/shared/domain/result";

import { type AuthError } from "./auth-error";

export interface UserProfileData {
  readonly displayName: string;
  readonly photoUrl?: string;
  readonly language: "es" | "en";
  readonly defaultCurrency: string;
}

export interface UserProfile extends UserProfileData {
  readonly _brand: "UserProfile";
}

interface CreateInput {
  displayName: string;
  photoUrl?: string;
  language: "es" | "en";
  defaultCurrency: string;
}

function createUserProfile(input: CreateInput): Result<UserProfile, AuthError> {
  if (!input.displayName || input.displayName.trim().length === 0) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }

  if (input.defaultCurrency.trim().length !== 3) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }

  if (input.language !== "es" && input.language !== "en") {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }

  const profile: UserProfile = {
    _brand: "UserProfile",
    displayName: input.displayName.trim(),
    language: input.language,
    defaultCurrency: input.defaultCurrency.trim().toUpperCase(),
    ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
  };

  return ok(profile);
}

// Namespace-style access: UserProfile.create(input)
export const UserProfile = { create: createUserProfile } as const;
