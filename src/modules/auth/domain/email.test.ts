import { describe, expect, it } from "vitest";

import { email } from "./email";

describe("Email value object", () => {
  describe("valid emails", () => {
    it("accepts a well-formed email and returns normalized lowercase value", () => {
      const result = email.create("User@Example.COM");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.value).toBe("user@example.com");
    });

    it("trims leading and trailing whitespace before validating", () => {
      const result = email.create("  hello@world.io  ");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.value).toBe("hello@world.io");
    });

    it("accepts a subdomain email", () => {
      const result = email.create("a@b.c.org");
      expect(result.ok).toBe(true);
    });
  });

  describe("invalid emails", () => {
    it("rejects an empty string", () => {
      const result = email.create("");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    });

    it("rejects a string missing the @ character", () => {
      const result = email.create("notanemail");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    });

    it("rejects a string with multiple @ characters", () => {
      const result = email.create("a@@b.com");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    });

    it("rejects a string missing the domain part", () => {
      const result = email.create("user@");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    });

    it("rejects a string missing the local part", () => {
      const result = email.create("@example.com");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    });

    it("rejects a whitespace-only string", () => {
      const result = email.create("   ");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidEmail");
    });
  });
});
