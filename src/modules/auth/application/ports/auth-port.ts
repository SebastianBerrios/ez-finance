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
  logout(): Promise<Result<void, AuthError>>;
  requestPasswordRecovery(email: Email): Promise<Result<void, AuthError>>;
  changePassword(
    current: Password | null,
    next: Password,
  ): Promise<Result<void, AuthError>>;
  changeEmail(next: Email): Promise<Result<void, AuthError>>;
  getCurrentUser(): Promise<Result<AuthUserRef, AuthError>>;
}
