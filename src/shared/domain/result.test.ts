import { describe, expect, it } from "vitest";

import { assertNever, err, ok } from "@shared/domain/result";

describe("Result helpers", () => {
  describe("ok()", () => {
    it("creates a successful result with the given value", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("creates a successful result with a string value", () => {
      const result = ok("hello");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("hello");
      }
    });
  });

  describe("err()", () => {
    it("creates a failure result with the given error", () => {
      const error = new Error("something went wrong");
      const result = err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });

    it("creates a failure result with a string error", () => {
      const result = err("validation failed");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("validation failed");
      }
    });
  });

  describe("assertNever()", () => {
    it("throws an error when called with an unexpected value", () => {
      // TypeScript would prevent this at compile time, but we test runtime behavior
      expect(() => assertNever("unexpected" as never)).toThrow(
        "Unexpected value"
      );
    });
  });
});
