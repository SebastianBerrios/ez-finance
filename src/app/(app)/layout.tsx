import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bootstrapUserWorkspace } from "@/modules/auth/infrastructure/bootstrap";
import { readOnboardingStatus } from "@/modules/onboarding/infrastructure/onboarding-status";

import { OfflineSync } from "./offline-sync";

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
  // DELIBERATELY bootstrapUserWorkspace() AND NOT resolveCurrentWorkspace(), even
  // though every page below this one uses the resolver. Do not "make it consistent".
  //
  // The gate asks whether the WIZARD finished, and the wizard configures the personal
  // anchor. Asking it about the currently selected space instead would send anyone who
  // just created an empty one to /onboarding — where the root checks the personal
  // workspace, finds it complete, and redirects back here. An infinite loop.
  //
  // An empty non-personal space is not a half-finished setup; it is a new space, and
  // the dashboard renders it as such.
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
  } else {
    // The dashboard divides by the month's income and buckets by category, so it
    // needs a budget config and an account to exist at all. Rather than teach
    // every screen to render a half-configured workspace, the wizard is a gate:
    // finish it once and everything downstream can assume its inputs.
    //
    // Checked HERE and not in the middleware: this is a database read, and the
    // middleware runs on every matched request including static navigations.
    // Paying two queries per request to answer a question that only changes once
    // per account is the wrong trade.
    const status = await readOnboardingStatus(entry.value.workspaceId);
    if (!status.complete) {
      redirect("/onboarding");
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      {/*
        ABOVE everything, and on every authenticated screen. It says when there is no
        connection, empties the queue when there is one again, and registers the service
        worker — none of which can depend on the person being on a particular page, since
        a reconnect happens wherever they happen to be.

        Mounted HERE and not in the root layout on purpose: the marketing and auth pages
        have nothing worth serving offline, and a worker scoped over them would start
        caching pages that set cookies.
      */}
      <OfflineSync />
      {children}
    </div>
  );
}
