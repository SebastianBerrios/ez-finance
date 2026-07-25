// supabase-auth-adapter.ts — implements AuthPort
// ONLY file in the auth module that imports @supabase/* for auth operations.
// All errors are mapped through mapSupabaseError(); no Supabase error code
// leaks past this file.
import {
  type AuthPort,
  type AuthUserRef,
  type LogoutScope,
  type SessionRef,
} from "@/modules/auth/application/ports/auth-port";
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Email } from "@/modules/auth/domain/email";
import { type Password } from "@/modules/auth/domain/password";
import { type Result, err, ok } from "@/shared/domain/result";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

import { mapSupabaseError } from "./error-map";

export class SupabaseAuthAdapter implements AuthPort {
  // ---------------------------------------------------------------------------
  // register — non-enumerating: existing-email returns ok (obfuscated by Supabase
  // when enable_confirmations=true) so the UI always shows "check your inbox".
  // ---------------------------------------------------------------------------
  async register(
    email: Email,
    password: Password,
  ): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value(),
      });

      // When email confirmations are enabled Supabase returns no error for an
      // already-registered address — it silently re-sends the confirmation.
      // If it does return an error here we only surface non-enumerating kinds.
      if (error) {
        const mapped = mapSupabaseError(error);
        // ConflictOrRejected from a duplicate email must not be forwarded
        // (that would be an enumeration oracle). Map it to ok to match the
        // "check your inbox" non-enumerating UX.
        if (mapped.kind === "ConflictOrRejected" || mapped.kind === "AuthenticationFailed") {
          return ok(undefined);
        }
        return err(mapped);
      }

      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // login
  // ---------------------------------------------------------------------------
  async login(
    email: Email,
    password: Password,
  ): Promise<Result<SessionRef, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value(),
      });

      if (error) return err(mapSupabaseError(error));
      if (!data.session) return err({ kind: "AuthenticationFailed" });

      return ok({
        userId: data.session.user.id,
        accessToken: data.session.access_token,
      });
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // logout — the scope is always passed explicitly.
  // supabase-js defaults signOut() to scope "global", which revokes every
  // refresh token on the auth.users row. In mvp-lab that row is SHARED with
  // fast_route and oasis, so the default would sign the person out of apps
  // this one has no business touching. Never call signOut() bare here.
  // ---------------------------------------------------------------------------
  async logout(scope: LogoutScope): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.auth.signOut({ scope });
      if (error) return err(mapSupabaseError(error));
      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // getCurrentUser — uses getUser() (server-validated) per vercel-react-best-practices
  // ---------------------------------------------------------------------------
  async getCurrentUser(): Promise<Result<AuthUserRef, AuthError>> {
    try {
      const supabase = await createServerClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error) return err(mapSupabaseError(error));
      if (!user || !user.email) return err({ kind: "SessionExpired" });

      return ok({ id: user.id, email: user.email });
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // requestPasswordRecovery — ALWAYS returns ok (non-enumeration)
  // ---------------------------------------------------------------------------
  async requestPasswordRecovery(email: Email): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      // Swallow errors intentionally — response is always generic ok
      await supabase.auth.resetPasswordForEmail(email.value);
      return ok(undefined);
    } catch {
      // Swallow all errors — never reveal whether account exists
      return ok(undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // changePassword — revokes other sessions on success
  // ---------------------------------------------------------------------------
  async changePassword(
    _current: Password | null,
    next: Password,
  ): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.auth.updateUser({
        password: next.value(),
      });

      if (error) return err(mapSupabaseError(error));

      // Revoke all OTHER sessions so password change takes immediate effect
      await supabase.auth.signOut({ scope: "others" });

      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // changeEmail — triggers double_confirm_changes natively
  // ---------------------------------------------------------------------------
  async changeEmail(next: Email): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.auth.updateUser({
        email: next.value,
      });

      if (error) return err(mapSupabaseError(error));
      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // initiateGoogleLogin — starts the OAuth flow server-side.
  // Returns the authorization URL the browser must navigate to.
  // skipBrowserRedirect: true tells supabase-js not to redirect (we handle it).
  // NOTE: Full end-to-end auth requires the Google provider to be configured
  // in the Supabase project (dashboard > Auth > Providers > Google).
  // ---------------------------------------------------------------------------
  async initiateGoogleLogin(
    redirectTo: string,
  ): Promise<Result<{ url: string }, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) return err(mapSupabaseError(error));
      if (!data.url) return err({ kind: "Unavailable" });

      return ok({ url: data.url });
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // completeOAuth — exchanges the authorization code for a session.
  // Called from the /auth/callback route handler after the OAuth redirect.
  // Uses the server client (SSR cookie-based session management).
  // ---------------------------------------------------------------------------
  async completeOAuth(code: string): Promise<Result<SessionRef, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) return err(mapSupabaseError(error));
      if (!data.session) return err({ kind: "AuthenticationFailed" });

      return ok({
        userId: data.session.user.id,
        accessToken: data.session.access_token,
      });
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }
}
