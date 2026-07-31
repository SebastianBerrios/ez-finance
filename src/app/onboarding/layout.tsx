import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { readOnboardingStatus } from "@/modules/onboarding/infrastructure/onboarding-status";

/** Reads the session cookie on every render; nothing here is prerenderable. */
export const dynamic = "force-dynamic";

/**
 * The wizard's shell.
 *
 * Deliberately OUTSIDE the (app) route group: that group redirects incomplete
 * workspaces to /onboarding, so a wizard living inside it would redirect to
 * itself. The middleware still requires a session for this path.
 *
 * NOTE ON WHAT IS *NOT* HERE. "Already configured, go to /app" lives on the wizard
 * ROOT page, not in this layout, and the difference is load-bearing: the income
 * step writes a complete config (income plus the 50/30/20 default), so from that
 * moment the workspace IS configured — and a blanket redirect here would throw the
 * person out of the wizard one step before the end. Each step guards only what it
 * can no longer ask: the account step skips itself when an account exists, because
 * the base currency it sets is immutable.
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-8">
      {children}
    </main>
  );
}
