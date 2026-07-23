import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Result, err } from "@/shared/domain/result";

import { type ProfilePort } from "./ports/profile-port";

interface SetPreferencesInput {
  userId: string;
  language?: "es" | "en";
  defaultCurrency?: string;
}

interface SetPreferencesDeps {
  profile: ProfilePort;
}

export async function setPreferences(
  input: SetPreferencesInput,
  deps: SetPreferencesDeps,
): Promise<Result<void, AuthError>> {
  if (
    input.language !== undefined &&
    input.language !== "es" &&
    input.language !== "en"
  ) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }

  if (
    input.defaultCurrency !== undefined &&
    input.defaultCurrency.trim().length !== 3
  ) {
    return err({ kind: "ConflictOrRejected" } satisfies AuthError);
  }

  const prefs: { language?: "es" | "en"; defaultCurrency?: string } = {};
  if (input.language !== undefined) prefs.language = input.language;
  if (input.defaultCurrency !== undefined)
    prefs.defaultCurrency = input.defaultCurrency;

  return deps.profile.setPreferences(input.userId, prefs);
}
