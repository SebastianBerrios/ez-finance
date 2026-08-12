"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { drainQueue } from "@/modules/offline/application/drain-queue";
import { syncOutcome } from "@/modules/offline/application/sync-contract";
import { sendPendingWrite } from "@/modules/offline/infrastructure/http-sync-sender";
import { IndexedDbPendingQueue } from "@/modules/offline/infrastructure/indexeddb-pending-queue";
import { OfflineBanner } from "@/modules/offline/ui/components/offline-banner";

import { QUEUED_EVENT } from "./offline-queue";

/**
 * The container that empties the offline queue, and registers the service worker.
 *
 * IN THE LAYOUT, so it is mounted on every screen behind the login: a reconnect happens
 * while the person is wherever they are, and a queue that only drained on one page would
 * leave movements waiting for a visit that may never come.
 *
 * It lives in the delivery layer rather than in the offline module because it wires
 * ADAPTERS — the IndexedDB queue and the HTTP sender — and that composition is this
 * layer's job. What it renders is a presentational component that knows none of them.
 */
export function OfflineSync() {
  const router = useRouter();
  // Assume online until the browser says otherwise: the first paint is server-rendered,
  // where navigator does not exist, and flashing "sin conexión" at someone who is online
  // is worse than a beat of silence.
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const drain = useCallback(async () => {
    const result = await drainQueue({
      queue: new IndexedDbPendingQueue(),
      send: sendPendingWrite,
    });

    setPending(result.remaining);

    const message = syncOutcome.notice(result.outcomes);
    if (message !== null) setNotice(message);

    // REFRESH when something landed. The figures on screen were computed without these
    // writes, and a queue that emptied while the dashboard still shows the old month is
    // indistinguishable from a queue that did nothing.
    const landed = result.outcomes.some(
      (outcome) =>
        outcome.kind === "Applied" || outcome.kind === "AppliedOverwriting",
    );
    if (landed) router.refresh();
  }, [router]);

  useEffect(() => {
    setOnline(navigator.onLine);

    function count() {
      void new IndexedDbPendingQueue().list().then((rows) => {
        setPending(rows.length);
      });
    }

    void new IndexedDbPendingQueue().list().then((rows) => {
      setPending(rows.length);
      // Drained on MOUNT as well as on the event: a browser closed while offline and
      // reopened with a connection never fires 'online', and the person would find their
      // movements still waiting for no visible reason.
      if (rows.length > 0 && navigator.onLine) void drain();
    });

    function handleOnline() {
      setOnline(true);
      void drain();
    }
    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener(QUEUED_EVENT, count);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(QUEUED_EVENT, count);
    };
  }, [drain]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // A failed registration is NOT reported to the person: without the worker the app
    // simply needs a connection to open, which is exactly how it behaved before this
    // existed. Nothing they could do about it either way.
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return (
    <OfflineBanner
      online={online}
      pending={pending}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    />
  );
}
