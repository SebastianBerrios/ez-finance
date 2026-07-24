// error-map.test.ts — unit tests for Supabase → AuthError mapping
// No live Supabase needed; feeds synthetic error objects.
import { describe, expect, it } from "vitest";

import { mapSupabaseError } from "./error-map";

describe("mapSupabaseError", () => {
  it("maps null/undefined to Unavailable", () => {
    expect(mapSupabaseError(null)).toEqual({ kind: "Unavailable" });
    expect(mapSupabaseError(undefined)).toEqual({ kind: "Unavailable" });
  });

  it("maps invalid_credentials code → AuthenticationFailed", () => {
    expect(mapSupabaseError({ code: "invalid_credentials", message: "" })).toEqual({
      kind: "AuthenticationFailed",
    });
  });

  it("maps user_not_found code → AuthenticationFailed", () => {
    expect(mapSupabaseError({ code: "user_not_found", message: "" })).toEqual({
      kind: "AuthenticationFailed",
    });
  });

  it("maps email_not_confirmed code → AuthenticationFailed (non-enum)", () => {
    expect(mapSupabaseError({ code: "email_not_confirmed", message: "" })).toEqual({
      kind: "AuthenticationFailed",
    });
  });

  it("maps over_email_send_rate_limit code → RateLimited", () => {
    expect(
      mapSupabaseError({ code: "over_email_send_rate_limit", message: "" }),
    ).toEqual({ kind: "RateLimited" });
  });

  it("maps HTTP 429 status → RateLimited regardless of code", () => {
    expect(mapSupabaseError({ status: 429, message: "too many requests" })).toEqual({
      kind: "RateLimited",
    });
  });

  it("maps session_not_found code → SessionExpired", () => {
    expect(mapSupabaseError({ code: "session_not_found", message: "" })).toEqual({
      kind: "SessionExpired",
    });
  });

  it("maps jwt_expired in message → SessionExpired", () => {
    expect(mapSupabaseError({ message: "JWT expired" })).toEqual({
      kind: "SessionExpired",
    });
  });

  it("maps reauthentication_needed code → ReauthRequired", () => {
    expect(
      mapSupabaseError({ code: "reauthentication_needed", message: "" }),
    ).toEqual({ kind: "ReauthRequired" });
  });

  it("maps email_exists code → ConflictOrRejected", () => {
    expect(mapSupabaseError({ code: "email_exists", message: "" })).toEqual({
      kind: "ConflictOrRejected",
    });
  });

  it("maps same_password code → ConflictOrRejected", () => {
    expect(mapSupabaseError({ code: "same_password", message: "" })).toEqual({
      kind: "ConflictOrRejected",
    });
  });

  it("maps weak_password code → WeakPassword", () => {
    expect(mapSupabaseError({ code: "weak_password", message: "" })).toEqual({
      kind: "WeakPassword",
    });
  });

  it("maps validation_failed code → InvalidEmail", () => {
    expect(mapSupabaseError({ code: "validation_failed", message: "" })).toEqual({
      kind: "InvalidEmail",
    });
  });

  it("maps authentication_failed generic message → AuthenticationFailed", () => {
    expect(
      mapSupabaseError({ message: "authentication failed" }),
    ).toEqual({ kind: "AuthenticationFailed" });
  });

  it("maps unknown code → Unavailable (fail closed)", () => {
    expect(mapSupabaseError({ code: "some_unknown_code_xyz", message: "" })).toEqual({
      kind: "Unavailable",
    });
  });

  it("maps completely unknown object → Unavailable", () => {
    expect(mapSupabaseError({ foo: "bar" })).toEqual({ kind: "Unavailable" });
  });

  it("does not leak any Supabase code string in the returned error", () => {
    const result = mapSupabaseError({ code: "some_unknown_code_xyz", message: "raw details" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("some_unknown_code_xyz");
    expect(serialized).not.toContain("raw details");
  });
});
