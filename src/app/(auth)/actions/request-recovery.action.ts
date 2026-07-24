"use server";

import { requestPasswordRecovery } from "@/modules/auth/application/request-password-recovery";
import { SupabaseAuthAdapter } from "@/modules/auth/infrastructure/supabase-auth-adapter";

export interface RequestRecoveryState {
  submitted?: boolean;
  error?: string;
}

// NON-ENUMERATING: always returns the same generic success state regardless
// of whether the email exists, uses Google, or any other backend condition.
export async function requestRecoveryAction(
  _prev: RequestRecoveryState,
  formData: FormData,
): Promise<RequestRecoveryState> {
  const email = (formData.get("email") as string | null) ?? "";

  const auth = new SupabaseAuthAdapter();
  // requestPasswordRecovery always returns ok — non-enumeration guaranteed at use-case layer.
  await requestPasswordRecovery({ email }, { auth });

  return { submitted: true };
}
