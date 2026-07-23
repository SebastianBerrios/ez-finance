import { describe, expect, it } from "vitest";

import { UserProfile } from "./user-profile";

describe("UserProfile value object", () => {
  const validInput = {
    displayName: "Angelo",
    language: "es" as const,
    defaultCurrency: "USD",
  };

  describe("valid inputs", () => {
    it("creates a UserProfile with required fields", () => {
      const result = UserProfile.create(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.displayName).toBe("Angelo");
        expect(result.value.language).toBe("es");
        expect(result.value.defaultCurrency).toBe("USD");
        expect(result.value.photoUrl).toBeUndefined();
      }
    });

    it("creates a UserProfile with optional photoUrl", () => {
      const result = UserProfile.create({
        ...validInput,
        photoUrl: "https://example.com/avatar.png",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.photoUrl).toBe("https://example.com/avatar.png");
      }
    });

    it("accepts language 'en'", () => {
      const result = UserProfile.create({ ...validInput, language: "en" });
      expect(result.ok).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects an empty displayName", () => {
      const result = UserProfile.create({ ...validInput, displayName: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    });

    it("rejects a currency code that is not 3 characters", () => {
      const result = UserProfile.create({
        ...validInput,
        defaultCurrency: "US",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    });

    it("rejects a currency code longer than 3 characters", () => {
      const result = UserProfile.create({
        ...validInput,
        defaultCurrency: "USDD",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    });

    it("rejects an invalid language value", () => {
      const result = UserProfile.create({
        ...validInput,
        language: "fr" as "es",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    });
  });
});
