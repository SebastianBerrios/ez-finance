import { type AuthError } from "@/modules/auth/domain/auth-error";
import { type Email } from "@/modules/auth/domain/email";
import { type Password } from "@/modules/auth/domain/password";
import { type Result } from "@/shared/domain/result";

export interface SessionRef {
  readonly userId: string;
  readonly accessToken: string;
}

export interface AuthUserRef {
  readonly id: string;
  readonly email: string;
}

/**
 * Which sessions a sign-out revokes.
 *
 * NEVER default this to "global" in ez finance: mvp-lab is a shared Supabase
 * project, so the refresh tokens hanging off one auth.users row belong to
 * fast_route and oasis too. A global sign-out here silently logs the person
 * out of the other apps in the fleet. Sessions cannot be scoped per app in a
 * shared project, so "local" (this browser only) is the maximum for a SIGN-OUT.
 *
 * THE ONE EXCEPTION IS PASSWORD ROTATION. changePassword() deliberately uses
 * "others": a password change exists to lock out whoever might be holding the
 * old one, and leaving their sessions alive defeats the point. It is the same
 * cross-app cost, paid on purpose — and it fires on the password-RECOVERY path
 * too, which is the common one. Both forms say so before the person submits.
 * Any OTHER use of "others" or "global" is a bug.
 */
export type LogoutScope = "local" | "others" | "global";

export interface AuthPort {
  register(email: Email, password: Password): Promise<Result<void, AuthError>>;
  login(
    email: Email,
    password: Password,
  ): Promise<Result<SessionRef, AuthError>>;
  initiateGoogleLogin(
    redirectTo: string,
  ): Promise<Result<{ url: string }, AuthError>>;
  completeOAuth(code: string): Promise<Result<SessionRef, AuthError>>;
  /** Scope is explicit — see LogoutScope: there is no safe default here. */
  logout(scope: LogoutScope): Promise<Result<void, AuthError>>;
  requestPasswordRecovery(email: Email): Promise<Result<void, AuthError>>;
  changePassword(
    current: Password | null,
    next: Password,
  ): Promise<Result<void, AuthError>>;
  changeEmail(next: Email): Promise<Result<void, AuthError>>;
  getCurrentUser(): Promise<Result<AuthUserRef, AuthError>>;
}
