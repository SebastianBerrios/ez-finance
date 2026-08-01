"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { WORKSPACE_COOKIE } from "@/app/(app)/current-workspace";
import { SupabaseWorkspaceAdapter } from "@/modules/workspaces/infrastructure/supabase-workspace-adapter";

export interface SwitchWorkspaceState {
  error?: string;
}

/**
 * Remember which workspace the person is looking at.
 *
 * MEMBERSHIP IS CHECKED HERE TOO, not only when the cookie is read back.
 * resolveCurrentWorkspace() already refuses a cookie the caller is not a member of, so
 * this check is not what makes the system safe — it is what stops a bad value from
 * being STORED in the first place. Writing an unverified id and relying on the reader
 * to discard it every time means the invariant lives in one place and the data
 * contradicts it, which is how a later refactor of the reader quietly becomes a hole.
 *
 * The cookie is httpOnly: nothing in the browser needs to read it, and the server
 * re-derives everything from it.
 */
export async function switchWorkspaceAction(
  _prev: SwitchWorkspaceState,
  formData: FormData,
): Promise<SwitchWorkspaceState> {
  const target = ((formData.get("workspaceId") as string | null) ?? "").trim();

  if (target.length === 0) {
    return { error: "No pudimos identificar el espacio." };
  }

  const member = await new SupabaseWorkspaceAdapter().isMember(target);

  if (!member.ok) {
    return { error: "No pudimos cambiar de espacio. Intenta de nuevo." };
  }

  if (!member.value) {
    // Deliberately the same message as a missing id. A caller poking at ids should
    // not learn from the wording whether the workspace exists.
    return { error: "No pudimos identificar el espacio." };
  }

  const store = await cookies();
  store.set(WORKSPACE_COOKIE, target, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // A year: this is a preference, not a credential. The session cookie is what
    // decides whether anything can be read with it.
    maxAge: 60 * 60 * 24 * 365,
  });

  // Everything under /app is scoped by the current workspace.
  revalidatePath("/app", "layout");

  return {};
}
