import { describe, expect, it, vi } from "vitest";

// origin.ts imports next/headers at module load; stub it here because
// resolveOrigin is pure and never touches the live request.
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { resolveOrigin } from "./origin";

describe("resolveOrigin", () => {
  it("defaults localhost to http", () => {
    expect(resolveOrigin("localhost:3000", null)).toBe("http://localhost:3000");
  });

  it("defaults loopback to http", () => {
    expect(resolveOrigin("127.0.0.1:3000", null)).toBe("http://127.0.0.1:3000");
  });

  it("defaults a public host to https", () => {
    expect(resolveOrigin("ez-finance.vercel.app", null)).toBe(
      "https://ez-finance.vercel.app",
    );
  });

  it("honors an explicit forwarded protocol", () => {
    expect(resolveOrigin("ez-finance.vercel.app", "http")).toBe(
      "http://ez-finance.vercel.app",
    );
  });

  it("falls back to localhost when the host is missing", () => {
    expect(resolveOrigin(null, null)).toBe("http://localhost:3000");
  });
});
