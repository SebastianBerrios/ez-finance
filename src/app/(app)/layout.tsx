import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";

/**
 * Authenticated entry point for every /app route.
 *
 * bootstrapUserWorkspace() runs HERE rather than on the landing page because
 * deep links exist: a user who opens /app/settings/... directly (bookmark, the
 * post-deletion login notice, a shared link) never passed through /app, and
 * used to reach the app with no profile row at all — settings reads then failed
 * with a generic "unavailable". It is idempotent and race-safe, and it is also
 * what sweeps a due account deletion, so binding it to the layout means the
 * sweep runs on any authenticated entry instead of only on the landing page.
 *
 * The middleware has already rejected unauthenticated requests; an expired
 * session simply makes this a no-op.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const entry = await bootstrapUserWorkspace();

  if (!entry.ok) {
    // Non-fatal: the children render and surface their own "unavailable" state.
    // Logged because a permanently failing bootstrap looks, from the outside,
    // exactly like an app that lost its data.
    console.error("[app/layout] bootstrapUserWorkspace failed:", entry.error);
  } else if (entry.value.kind === "DELETED") {
    // The grace window expired and this request erased the data. Handing back
    // a rendered app would be a lie. /auth/deleted closes the session (a Server
    // Component cannot) and lands on the login notice.
    redirect("/auth/deleted");
  }

  return <div className="flex min-h-screen w-full flex-col">{children}</div>;
}
