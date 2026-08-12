"use client";

/**
 * Erase everything this device kept for offline use.
 *
 * CALLED ON LOGOUT, and it is not housekeeping — it is the privacy half of caching
 * authenticated pages. A cached /app response is a rendered dashboard with real amounts
 * in it; leaving it in Cache Storage after the session ends would let the next person on
 * a shared computer read it, which §3.1 does not allow.
 *
 * Both halves matter. The page deletes the caches itself so the work is done even if the
 * service worker is not controlling this page yet, and it also messages the worker,
 * because a navigation that starts mid-purge would otherwise leave it half finished.
 *
 * The QUEUE IS DELIBERATELY LEFT ALONE. It holds movements the person recorded and
 * believes are saved; erasing them on logout would silently throw away their money, and
 * they are useless to anyone else — every one of them is re-validated against whatever
 * session is present when it finally drains, and RLS refuses the rest.
 */
export async function purgeOfflineCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: "purge" });
    }

    if (typeof caches === "undefined") return;

    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith("ez-finance-"))
        .map((name) => caches.delete(name)),
    );
  } catch {
    // Nothing useful to do or say: the logout itself must not be blocked by a cache
    // that would not open.
  }
}
