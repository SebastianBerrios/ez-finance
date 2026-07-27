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
import { getRequestOrigin } from "@/shared/infrastructure/http/origin";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

import { mapSupabaseError } from "./error-map";

// Where each transactional email has to land. Built from the origin of the
// request that triggered the mail, never from the Supabase project's Site URL:
// mvp-lab is ONE project shared by the fleet, so that Site URL is a single
// default belonging to no app in particular. See getRequestOrigin().
//
// Both paths below are route handlers excluded from the middleware matcher —
// they have to be reachable without a session, because the code exchange IS
// the authentication.
const CALLBACK_PATH = "/auth/callback";
const RECOVERY_PATH = "/auth/reset-password";

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
      const origin = await getRequestOrigin();
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value(),
        options: { emailRedirectTo: `${origin}${CALLBACK_PATH}` },
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
  //
  // This one sends a link whether or not signup confirmations are enabled, so
  // an explicit redirectTo is not optional: without it the recovery mail points
  // at the shared Site URL and the user never reaches ez finance's form.
  // ---------------------------------------------------------------------------
  async requestPasswordRecovery(email: Email): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const origin = await getRequestOrigin();
      // Swallow errors intentionally — response is always generic ok
      await supabase.auth.resetPasswordForEmail(email.value, {
        redirectTo: `${origin}${RECOVERY_PATH}`,
      });
      return ok(undefined);
    } catch {
      // Swallow all errors — never reveal whether account exists
      return ok(undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // changePassword — revokes every OTHER session on success.
  //
  // THIS ONE IS DELIBERATELY FLEET-WIDE, and it is the only place that is.
  // Everywhere else (logout, the deletion flow) the scope is "local", because
  // mvp-lab shares one auth.users row with fast_route and oasis and signing out
  // of ez finance has no business touching them.
  //
  // A password is different: it protects the SHARED identity itself, not this
  // app's data. A password change is usually made BECAUSE the old one may be
  // compromised, so leaving the other apps' refresh tokens alive would keep the
  // attacker in — and there is no way to revoke "only ez finance's" sessions in
  // a shared project. Revoking all of them is the honest behaviour.
  //
  // It goes through the port with an explicit scope rather than calling
  // signOut() directly: the scope is a decision, and the decision lives in one
  // place. "others", never "global" — the browser doing the change stays in.
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

      const revoked = await this.logout("others");

      if (!revoked.ok) {
        // The password IS changed, so failing here would tell the user to retry
        // with a password that already works. But a silent failure leaves
        // possibly stolen sessions alive on a credential the user believes was
        // rotated — that has to be visible somewhere.
        console.error(
          "[auth/changePassword] revoking the other sessions failed:",
          revoked.error,
        );
      }

      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  // ---------------------------------------------------------------------------
  // changeEmail — triggers double_confirm_changes natively
  //
  // Like recovery, this mails a link unconditionally, so it needs an explicit
  // redirect too. double_confirm_changes sends one to the OLD address and one
  // to the new; both carry this same redirect.
  // ---------------------------------------------------------------------------
  async changeEmail(next: Email): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const origin = await getRequestOrigin();
      const { error } = await supabase.auth.updateUser(
        { email: next.value },
        { emailRedirectTo: `${origin}${CALLBACK_PATH}` },
      );

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
