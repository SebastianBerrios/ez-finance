import { describe, expect, it } from "vitest";

import { passwordPolicy } from "./password-policy";

describe("PasswordPolicy", () => {
  describe("valid passwords", () => {
    it("accepts a password with >=10 chars, at least one letter and one digit", () => {
      const result = passwordPolicy.validate("Password1!");
      expect(result.ok).toBe(true);
    });

    it("accepts exactly 10 chars with a letter and a digit", () => {
      const result = passwordPolicy.validate("Password10");
      expect(result.ok).toBe(true);
    });

    it("accepts long mixed passwords", () => {
      const result = passwordPolicy.validate("SuperSecure123456");
      expect(result.ok).toBe(true);
    });

    it("accepts accented Unicode letters as a letter (ñ, é) plus a digit", () => {
      // "ññññññññ1" — 9 chars, still < 10; add one more to reach 10.
      const result = passwordPolicy.validate("ñññññññññ1");
      expect(result.ok).toBe(true);
    });

    it("accepts a Unicode digit as satisfying the number rule", () => {
      // Arabic-Indic digit ٥ (U+0665) is a Unicode number; letters via 'password'.
      const result = passwordPolicy.validate("passwordé٥");
      expect(result.ok).toBe(true);
    });

    it("accepts exactly 10 code points with a letter and a digit", () => {
      const result = passwordPolicy.validate("abcdef1234");
      expect(result.ok).toBe(true);
    });
  });

  describe("invalid passwords", () => {
    it("rejects a password shorter than 10 characters", () => {
      const result = passwordPolicy.validate("short1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    });

    it("rejects a password with no digit (all letters)", () => {
      const result = passwordPolicy.validate("alllettters");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    });

    it("rejects a password with 10 chars but no digit", () => {
      const result = passwordPolicy.validate("AAAAAAAAAA");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    });

    it("rejects a password with 10 digits but no letter", () => {
      const result = passwordPolicy.validate("0000000000");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    });

    it("rejects an empty string", () => {
      const result = passwordPolicy.validate("");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    });

    it("rejects exactly 9 chars even with letter and digit (boundary)", () => {
      const result = passwordPolicy.validate("abcdefgh1"); // 9 code points
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    });

    it("rejects accented all-letters with no number (>=10)", () => {
      const result = passwordPolicy.validate("ñññññññññé"); // 10 letters, no digit
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("WeakPassword");
    });
  });

  describe("Password value object", () => {
    it("exposes the raw value via value() accessor", () => {
      const result = passwordPolicy.validate("Password1!");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.value()).toBe("Password1!");
    });
  });
});
