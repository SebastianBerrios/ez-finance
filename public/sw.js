// ez finance — service worker.
//
// WHAT IT IS FOR (spec §3.3, "offline-first como derecho"): being able to OPEN the app
// without a connection and see the month as you last left it. Recording while offline is
// the queue's job, in the app itself — a service worker cannot validate a movement.
//
// HAND-WRITTEN, no build step and no dependency. It is the one file that has to keep
// working when everything else is unreachable, so it is small enough to read in full.
//
// THE PRIVACY CONSEQUENCE, and it is the reason this file needs a message handler.
// Caching /app responses means a rendered dashboard — real amounts — sits in Cache
// Storage on the device. On a shared computer that would outlive the session, which
// contradicts §3.1. So the app PURGES these caches on logout and on account deletion,
// and the purge is here as well as in the page because a page that navigates away
// mid-purge would otherwise leave it half done.

const VERSION = "v1";
const SHELL_CACHE = `ez-finance-shell-${VERSION}`;
const PAGES_CACHE = `ez-finance-pages-${VERSION}`;
const OURS = /^ez-finance-(shell|pages)-/;

/** Rendered pages worth having offline. Everything else falls through to the network. */
const CACHEABLE_PATH = /^\/app(\/|$)/;

/**
 * NEVER CACHED, and each for its own reason:
 *  - /api/*   : the sync endpoint. A cached answer to a queued write would be a lie.
 *  - /auth/*, /login, /register, /set-password: they set cookies and read one-time
 *    tokens; a cached copy is at best useless and at worst shows a stale session state.
 */
const NEVER =
  /^\/(api|auth)(\/|$)|^\/(login|register|set-password|forgot-password)(\/|$)/;

self.addEventListener("install", (event) => {
  // No precache list on purpose: the app's asset names are content-hashed and change
  // every deploy, so a hardcoded list would go stale silently. What matters offline is
  // what the person has actually visited, and that is what runtime caching collects.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop the previous version's caches, so a deploy cannot serve last week's shell.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => OURS.test(name) && !name.endsWith(VERSION))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "purge") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => OURS.test(name))
            .map((name) => caches.delete(name)),
        );
      })(),
    );
  }
});

/** Content-hashed assets: safe to serve from cache forever, and free to keep. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Pages: the NETWORK IS ALWAYS PREFERRED, and that ordering is not a detail.
 *
 * These are financial figures. Showing a cached balance when the live one is reachable
 * would be showing a number that may already be wrong — the cache exists for when there
 * is no answer at all, not to make things feel faster.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // WRITES ARE NEVER TOUCHED. A POST replayed from a cache would duplicate a movement,
  // and the offline queue in the app is what owns writes.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.test(url.pathname)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate" && CACHEABLE_PATH.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});
