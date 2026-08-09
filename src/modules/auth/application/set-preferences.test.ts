import { describe, expect, it, vi } from "vitest";

import { type UserProfile } from "@/modules/auth/domain/user-profile";
import { ok, err } from "@/shared/domain/result";

import { type ProfilePort } from "./ports/profile-port";
import { setPreferences } from "./set-preferences";

function makeProfile(): UserProfile {
  return {
    _brand: "UserProfile",
    displayName: "Test User",
    language: "es",
    defaultCurrency: "USD",
  };
}

function makeFakeProfilePort(
  overrides: Partial<ProfilePort> = {},
): ProfilePort {
  return {
    getProfile: vi.fn().mockResolvedValue(ok(makeProfile())),
    updateProfile: vi.fn().mockResolvedValue(ok(makeProfile())),
    setPreferences: vi.fn().mockResolvedValue(ok(undefined)),
    uploadAvatar: vi
      .fn()
      .mockResolvedValue(ok({ photoUrl: "https://example.com/avatar.jpg" })),
    ...overrides,
  };
}

describe("setPreferences use case", () => {
  it("delegates to profile.setPreferences and returns ok", async () => {
    const profile = makeFakeProfilePort();
    const result = await setPreferences(
      { userId: "u1", language: "en", defaultCurrency: "EUR" },
      { profile },
    );
    expect(result.ok).toBe(true);
    expect(profile.setPreferences).toHaveBeenCalledWith("u1", {
      language: "en",
      defaultCurrency: "EUR",
    });
  });

  it("returns err(ConflictOrRejected) when language is invalid", async () => {
    const profile = makeFakeProfilePort();
    const result = await setPreferences(
      { userId: "u1", language: "fr" as "en" },
      { profile },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    expect(profile.setPreferences).not.toHaveBeenCalled();
  });

  it("returns err(ConflictOrRejected) when currency is not 3 characters", async () => {
    const profile = makeFakeProfilePort();
    const result = await setPreferences(
      { userId: "u1", defaultCurrency: "US" },
      { profile },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ConflictOrRejected");
    expect(profile.setPreferences).not.toHaveBeenCalled();
  });

  it("passes through when no language or currency is provided", async () => {
    const profile = makeFakeProfilePort();
    const result = await setPreferences({ userId: "u1" }, { profile });
    expect(result.ok).toBe(true);
  });
});
