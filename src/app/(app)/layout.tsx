import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";

/**
 * Is this render actually serving a request that carries a session?
 *
 * `next build` runs a prerender pass over every route. There is no request
 * scope there, so `cookies()` throws and bootstrapUserWorkspace() reports
 * Unavailable — seven times per build. Logging that is worse than useless: it
 * trains everyone to ignore the one message that means "authenticated users are
 * hitting a broken bootstrap".
 */
async function hasRequestSession(): Promise<boolean> {
  try {
    const store = await cookies();
    // @supabase/ssr writes the session under `sb-<ref>-auth-token[.n]`.
    return store.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  } catch {
    return false;
  }
}

/**
 * Authenticated entry point for every /app route.
 *
 * bootstrapUserWorkspace() runs HERE rather than on the landing page because
 * deep links exist: a user who opens /app/settings/... directly (bookmark, the
 * post-deletion login notice, a shared link) never passed through /app, and
 * used to reach the app with no profile row at all — settings reads then failed
 * with a generic "unavailable". It is idempotent and race-safe, and it is also
 * where the account lifecycle is resolved, so binding it to the layout means
 * every authenticated entry is checked instead of only the landing page.
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
    if (await hasRequestSession()) {
      console.error("[app/layout] bootstrapUserWorkspace failed:", entry.error);
    }
  } else if (entry.value.kind === "DELETED") {
    // The grace window expired and the data is gone — whether this request
    // erased it or the scheduled worker did weeks ago. Handing back a rendered
    // app would be a lie. /auth/deleted acknowledges the erasure and closes the
    // session (a Server Component cannot) before the login notice.
    redirect("/auth/deleted");
  }

  return <div className="flex min-h-screen w-full flex-col">{children}</div>;
}
