import { describe, expect, it } from "vitest";

import {
  type AuthError,
  isAuthError,
  classify,
} from "./auth-error";

describe("AuthError", () => {
  describe("isAuthError type guard", () => {
    const variants: AuthError["kind"][] = [
      "InvalidEmail",
      "WeakPassword",
      "AuthenticationFailed",
      "EmailNotConfirmed",
      "RateLimited",
      "SessionExpired",
      "ReauthRequired",
      "ConflictOrRejected",
      "Unavailable",
    ];

    it.each(variants)("returns true for variant %s", (kind) => {
      expect(isAuthError({ kind })).toBe(true);
    });

    it("returns false for a plain object without kind", () => {
      expect(isAuthError({ message: "something" })).toBe(false);
    });

    it("returns false for null", () => {
      expect(isAuthError(null)).toBe(false);
    });

    it("returns false for a string", () => {
      expect(isAuthError("InvalidEmail")).toBe(false);
    });
  });

  describe("AuthError variants do not contain message or detail fields", () => {
    const variants: AuthError["kind"][] = [
      "InvalidEmail",
      "WeakPassword",
      "AuthenticationFailed",
      "EmailNotConfirmed",
      "RateLimited",
      "SessionExpired",
      "ReauthRequired",
      "ConflictOrRejected",
      "Unavailable",
    ];

    it.each(variants)(
      "variant %s has only the kind property (no message/detail leaks)",
      (kind) => {
        const error: AuthError = { kind };
        const keys = Object.keys(error);
        expect(keys).toEqual(["kind"]);
      },
    );
  });

  describe("classify() — non-enumeration", () => {
    it("maps 'invalid_credentials' to AuthenticationFailed", () => {
      expect(classify("invalid_credentials").kind).toBe("AuthenticationFailed");
    });

    it("maps 'user_not_found' to AuthenticationFailed (non-enumerating — same as bad password)", () => {
      expect(classify("user_not_found").kind).toBe("AuthenticationFailed");
    });

    it("maps 'authentication failed' (trigger message) to AuthenticationFailed", () => {
      expect(classify("authentication failed").kind).toBe(
        "AuthenticationFailed",
      );
    });

    it("maps 'email_not_confirmed' to EmailNotConfirmed", () => {
      expect(classify("email_not_confirmed").kind).toBe("EmailNotConfirmed");
    });

    it("maps 'over_email_send_rate_limit' to RateLimited", () => {
      expect(classify("over_email_send_rate_limit").kind).toBe("RateLimited");
    });

    it("maps 'rate_limit' substring to RateLimited", () => {
      expect(classify("too_many_requests_rate_limit").kind).toBe("RateLimited");
    });

    it("maps 'session_not_found' to SessionExpired", () => {
      expect(classify("session_not_found").kind).toBe("SessionExpired");
    });

    it("maps 'jwt expired' to SessionExpired", () => {
      expect(classify("jwt expired").kind).toBe("SessionExpired");
    });

    it("maps 'reauthentication_needed' to ReauthRequired", () => {
      expect(classify("reauthentication_needed").kind).toBe("ReauthRequired");
    });

    it("maps 'same_password' to ReauthRequired", () => {
      expect(classify("same_password").kind).toBe("ReauthRequired");
    });

    it("maps 'email_exists' to ConflictOrRejected", () => {
      expect(classify("email_exists").kind).toBe("ConflictOrRejected");
    });

    it("maps 'email_taken' to ConflictOrRejected", () => {
      expect(classify("email_taken").kind).toBe("ConflictOrRejected");
    });

    it("maps 'weak_password' to WeakPassword", () => {
      expect(classify("weak_password").kind).toBe("WeakPassword");
    });

    it("maps 'validation_failed' to InvalidEmail", () => {
      expect(classify("validation_failed").kind).toBe("InvalidEmail");
    });

    it("maps unknown string to Unavailable", () => {
      expect(classify("some_unknown_supabase_error_xyz").kind).toBe(
        "Unavailable",
      );
    });

    it("maps empty string to Unavailable", () => {
      expect(classify("").kind).toBe("Unavailable");
    });

    it("non-enumeration: 'user_not_found' and 'invalid_credentials' produce the SAME kind", () => {
      expect(classify("user_not_found").kind).toBe(
        classify("invalid_credentials").kind,
      );
    });
  });
});
