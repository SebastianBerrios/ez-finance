// current-workspace.ts — "which workspace is this request about?"
//
// Read by every page and action under (app), the way bootstrapUserWorkspace() used to
// be. Onboarding deliberately does NOT use it: that flow configures the personal
// anchor, not whichever space happens to be selected.
//
// IT LIVES IN THE DELIVERY LAYER, not in the workspaces module, and eslint-plugin-
// boundaries is what made that explicit: it composes auth's bootstrap with the
// workspaces adapter, and one module reaching into another's infrastructure is exactly
// what that rule forbids. src/app is the only layer allowed to know about both, which
// is the same reasoning the movement form's comment gives for declaring its own option
// types instead of importing two modules' ports.
import { cookies } from "next/headers";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { SupabaseWorkspaceAdapter } from "@/modules/workspaces/infrastructure/supabase-workspace-adapter";
import type { Result } from "@shared/domain/result";
import { err, ok } from "@shared/domain/result";

/** Where the selection is remembered. Read-only from the client's point of view. */
export const WORKSPACE_COOKIE = "ez_finance_workspace";

export type CurrentWorkspace =
  | {
      readonly kind: "READY";
      readonly workspaceId: string;
      /** True when this is the bootstrap anchor rather than a chosen space. */
      readonly isPersonal: boolean;
      /** The personal anchor, always resolved — onboarding and fallbacks need it. */
      readonly personalWorkspaceId: string;
      /**
       * The selected space is ARCHIVED: readable, and refused by every write path.
       *
       * Carried here rather than re-read per page because the whole app funnels
       * through this function, and a screen that offers a button the database will
       * refuse is the failure archiving was supposed to prevent. The personal
       * anchor can never be archived (20260807210000), so this is always false
       * when isPersonal is true.
       */
      readonly isArchived: boolean;
    }
  | { readonly kind: "DELETED" };

export type CurrentWorkspaceError =
  { readonly kind: "SessionExpired" } | { readonly kind: "Unavailable" };

/**
 * Resolve the workspace this request is about.
 *
 * THE COOKIE IS NOT TRUSTED, and that is the whole reason this function exists rather
 * than a one-line read. A cookie is client-supplied: anyone can put any UUID in it. So
 * the selection is checked against MEMBERSHIP before it is used, and falls back to the
 * personal anchor when it fails.
 *
 * RLS would already make a foreign workspace return empty results rather than leak
 * anything — every policy scopes on workspace_ids_for_current_user() — so the failure
 * mode without this check is a confusing blank dashboard, not a breach. "The layer
 * below catches it" is a reason to sleep at night, not a reason to skip the check:
 * silently showing someone an empty version of a stranger's workspace is still wrong,
 * and the next policy someone writes might not be as careful.
 *
 * A membership check that FAILS TO RUN falls back to personal too. An unreadable
 * answer is not a yes.
 */
export async function resolveCurrentWorkspace(): Promise<
  Result<CurrentWorkspace, CurrentWorkspaceError>
> {
  const entry = await bootstrapUserWorkspace();

  if (!entry.ok) {
    return err(
      entry.error.kind === "SessionExpired"
        ? { kind: "SessionExpired" }
        : { kind: "Unavailable" },
    );
  }

  if (entry.value.kind === "DELETED") return ok({ kind: "DELETED" });

  const personalWorkspaceId = entry.value.workspaceId;

  const store = await cookies();
  const selected = store.get(WORKSPACE_COOKIE)?.value?.trim() ?? "";

  if (selected.length === 0 || selected === personalWorkspaceId) {
    return ok({
      kind: "READY",
      workspaceId: personalWorkspaceId,
      isPersonal: true,
      personalWorkspaceId,
      isArchived: false,
    });
  }

  const membership = await new SupabaseWorkspaceAdapter().findMembership(
    selected,
  );

  if (!membership.ok || membership.value === null) {
    // Stale cookie (a workspace since left, archived out of existence or deleted),
    // or one that was never theirs. Either way the honest answer is the space we
    // know they own.
    return ok({
      kind: "READY",
      workspaceId: personalWorkspaceId,
      isPersonal: true,
      personalWorkspaceId,
      isArchived: false,
    });
  }

  return ok({
    kind: "READY",
    workspaceId: selected,
    isPersonal: false,
    personalWorkspaceId,
    isArchived: membership.value.archived,
  });
}
