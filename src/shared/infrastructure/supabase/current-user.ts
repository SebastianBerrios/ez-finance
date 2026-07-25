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

export const getAuthenticatedUser = cache(async () => {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { user, error };
});
