// current-user.ts — per-request memoized session read.
//
// supabase.auth.getUser() is NOT a local JWT decode: it is a network round trip
// to the Auth server on every call. An authenticated render used to pay for it
// three times (middleware, the (app) layout's bootstrap, then the page), and
// /app/settings/account paid for six once the deletion sweep landed.
//
// React.cache() deduplicates within a single request, so the layout and the
// page it wraps share one round trip. The middleware runs in its own runtime
// and keeps its own call — that one is what refreshes the session cookie.
//
// No arguments on purpose (server-cache-react): cache() compares arguments by
// Object.is, so an inline object would miss the cache on every call.
import { cache } from "react";

import { createServerClient } from "./server";

// The client is returned alongside the user on purpose. getUser() can REFRESH
// the access token, and that refreshed token lives on the client instance that
// performed the call. A caller that validates here and then issues its RPCs on
// a second, separately built client sends the stale token instead — so anyone
// who needs both takes the client from here rather than building their own.
export const getAuthenticatedUser = cache(async () => {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { supabase, user, error };
});
