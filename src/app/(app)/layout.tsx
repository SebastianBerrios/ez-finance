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
  await bootstrapUserWorkspace();

  return <div className="flex min-h-screen w-full flex-col">{children}</div>;
}
