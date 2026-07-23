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
  });

  describe("Password value object", () => {
    it("exposes the raw value via value() accessor", () => {
      const result = passwordPolicy.validate("Password1!");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.value()).toBe("Password1!");
    });
  });
});
