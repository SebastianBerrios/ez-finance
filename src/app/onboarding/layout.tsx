import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { readOnboardingStatus } from "@/modules/onboarding/infrastructure/onboarding-status";

/** Reads the session cookie on every render; nothing here is prerenderable. */
export const dynamic = "force-dynamic";

/**
 * The wizard's own gate, and the mirror image of the (app) layout's.
 *
 * (app) sends an UNCONFIGURED workspace here; this sends a CONFIGURED one back.
 * Without the second half, someone who finished setup could reopen /onboarding and
 * be asked for an account currency that is already immutable.
 *
 * Deliberately OUTSIDE the (app) route group: that group redirects incomplete
 * workspaces to /onboarding, so a wizard living inside it would redirect to
 * itself. The middleware still requires a session for this path.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const entry = await bootstrapUserWorkspace();

  if (!entry.ok) {
    // No workspace means nothing to configure. /app handles the unavailable
    // case and its own redirects, so this defers rather than duplicating them.
    redirect("/app");
  }

  if (entry.value.kind === "DELETED") {
    redirect("/auth/deleted");
  }

  const status = await readOnboardingStatus(entry.value.workspaceId);
  if (status.complete) {
    redirect("/app");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-8">
      {children}
    </main>
  );
}
