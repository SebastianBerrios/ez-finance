import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";

/**
 * Every /app render reads the session cookie, so there is nothing here to
 * prerender.
 *
 * This replaces a try/catch around `cookies()` that existed to keep `next
 * build`'s prerender pass from logging seven bogus bootstrap failures. That
 * catch swallowed the `DynamicServerError` Next.js THROWS ON PURPOSE to mark a
 * segment dynamic — the correct way to say "do not prerender this" is to say
 * it, not to hide the signal.
 */
export const dynamic = "force-dynamic";

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
    console.error("[app/layout] bootstrapUserWorkspace failed:", entry.error);
  } else if (entry.value.kind === "DELETED") {
    // The grace window expired and the data is gone — whether this request
    // erased it or the scheduled worker did weeks ago. Handing back a rendered
    // app would be a lie. /auth/deleted shows the notice and, once the person
    // confirms, closes the session (a Server Component cannot write cookies).
    redirect("/auth/deleted");
  }

  return <div className="flex min-h-screen w-full flex-col">{children}</div>;
}
