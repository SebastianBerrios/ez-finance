import { describe, expect, it } from "vitest";

import { type AuthError, isAuthError, classify } from "./auth-error";

describe("AuthError", () => {
  describe("isAuthError type guard", () => {
    const variants: AuthError["kind"][] = [
      "InvalidEmail",
      "WeakPassword",
      "AuthenticationFailed",
      "RateLimited",
      "SessionExpired",
      "ReauthRequired",
      "ConflictOrRejected",
      "Unavailable",
    ];

    it.each(variants)("returns true for variant %s", (kind) => {
      expect(isAuthError({ kind })).toBe(true);
    });

    it("returns false for the removed EmailNotConfirmed variant", () => {
      // EmailNotConfirmed was removed to close a login enumeration oracle.
      expect(isAuthError({ kind: "EmailNotConfirmed" })).toBe(false);
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

    it("maps 'email_not_confirmed' to AuthenticationFailed (non-enumerating — no existence oracle on login)", () => {
      expect(classify("email_not_confirmed").kind).toBe("AuthenticationFailed");
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

    it("maps 'same_password' to ConflictOrRejected (benign rejection — NOT a re-auth loop)", () => {
      expect(classify("same_password").kind).toBe("ConflictOrRejected");
    });

    it("maps 'email_exists' to ConflictOrRejected", () => {
      expect(classify("email_exists").kind).toBe("ConflictOrRejected");
    });

    // The code Supabase ACTUALLY returns for a duplicate signup is
    // `user_already_exists` — it says "user", not "email", so it matched none of
    // the conflict codes and fell through to Unavailable. register() only
    // swallows ConflictOrRejected, so the form answered a taken address with an
    // error while a fresh one redirected to /check-email: an enumeration oracle
    // in the one flow that is written to be non-enumerating.
    it.each(["user_already_exists", "user_already_registered"])(
      "maps '%s' to ConflictOrRejected (duplicate signup must not be an oracle)",
      (code) => {
        expect(classify(code).kind).toBe("ConflictOrRejected");
      },
    );

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

    it("non-enumeration on the login path: email_not_confirmed, user_not_found and invalid_credentials all collapse to the SAME kind", () => {
      const notConfirmed = classify("email_not_confirmed").kind;
      const notFound = classify("user_not_found").kind;
      const badCreds = classify("invalid_credentials").kind;
      expect(notConfirmed).toBe(notFound);
      expect(notFound).toBe(badCreds);
      expect(notConfirmed).toBe("AuthenticationFailed");
    });

    it("keeps 'reauthentication_needed' mapped to ReauthRequired", () => {
      expect(classify("reauthentication_needed").kind).toBe("ReauthRequired");
    });

    describe("adversarial / robust matching (exact-code, not loose substrings)", () => {
      it("a multi-token conflict code containing 'email_exists' does not misroute or leak", () => {
        // Must classify as a benign conflict, never AuthenticationFailed/leak.
        expect(classify("validation_failed: email_exists").kind).toBe(
          "ConflictOrRejected",
        );
      });

      it("an unrelated natural-language message containing 'no user' does not misroute to SessionExpired", () => {
        // Loose substring matching would have hit "no user" → SessionExpired.
        // Robust matching must fall through to the fail-closed default.
        expect(classify("there is no user-facing problem here").kind).toBe(
          "Unavailable",
        );
      });

      it("an unknown multi-token message classifies safely as Unavailable (fail-closed)", () => {
        expect(classify("weird arbitrary provider chatter 12345").kind).toBe(
          "Unavailable",
        );
      });

      it("never echoes the raw code back in the returned error object", () => {
        const raw = "some_unknown_supabase_error_xyz";
        const result = classify(raw);
        expect(Object.keys(result)).toEqual(["kind"]);
        expect(JSON.stringify(result)).not.toContain(raw);
      });
    });
  });
});
