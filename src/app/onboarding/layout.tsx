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
 * ROOT page, not in this layout, and the difference is load-bearing: step 1 writes
 * a config row the moment the split is chosen, so a blanket redirect here would
 * throw the person out of the wizard on step 2. Each step guards only what it can
 * no longer ask: the account step skips itself when an account exists, because the
 * base currency it sets is immutable.
 *
 * What keeps that early config row from reading as "configured" is that
 * readOnboardingStatus requires an income above zero, not merely a row — see the
 * note on OnboardingStatus.hasBudgetConfig.
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
