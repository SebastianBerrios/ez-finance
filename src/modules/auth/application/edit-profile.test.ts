import { describe, expect, it, vi } from "vitest";

import { type UserProfile } from "@/modules/auth/domain/user-profile";
import { ok, err } from "@/shared/domain/result";

import { editProfile } from "./edit-profile";
import { type ProfilePort, type AvatarFile } from "./ports/profile-port";

function makeProfile(overrides: Partial<Omit<UserProfile, "_brand">> = {}): UserProfile {
  return {
    _brand: "UserProfile",
    displayName: "Test User",
    language: "es",
    defaultCurrency: "USD",
    ...overrides,
  };
}

function makeFakeProfilePort(overrides: Partial<ProfilePort> = {}): ProfilePort {
  return {
    getProfile: vi.fn().mockResolvedValue(ok(makeProfile())),
    updateProfile: vi.fn().mockResolvedValue(ok(makeProfile())),
    setPreferences: vi.fn().mockResolvedValue(ok(undefined)),
    uploadAvatar: vi.fn().mockResolvedValue(ok({ photoUrl: "https://example.com/avatar.jpg" })),
    ...overrides,
  };
}

describe("editProfile use case", () => {
  it("updates profile when displayName is provided", async () => {
    const updatedProfile = makeProfile({ displayName: "New Name" });
    const profile = makeFakeProfilePort({
      updateProfile: vi.fn().mockResolvedValue(ok(updatedProfile)),
    });

    const result = await editProfile(
      { userId: "u1", displayName: "New Name" },
      { profile },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayName).toBe("New Name");
    expect(profile.updateProfile).toHaveBeenCalledOnce();
  });

  it("uploads avatar when file is provided", async () => {
    const file: AvatarFile = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3 };
    const profile = makeFakeProfilePort();

    const result = await editProfile(
      { userId: "u1", avatar: file },
      { profile },
    );
    expect(result.ok).toBe(true);
    expect(profile.uploadAvatar).toHaveBeenCalledWith("u1", file);
  });

  it("propagates updateProfile error", async () => {
    const profile = makeFakeProfilePort({
      updateProfile: vi.fn().mockResolvedValue(err({ kind: "Unavailable" })),
    });
    const result = await editProfile({ userId: "u1", displayName: "New" }, { profile });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
  });

  it("propagates avatar upload error without calling updateProfile", async () => {
    const file: AvatarFile = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3 };
    const profile = makeFakeProfilePort({
      uploadAvatar: vi.fn().mockResolvedValue(err({ kind: "Unavailable" })),
    });

    const result = await editProfile(
      { userId: "u1", avatar: file },
      { profile },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("Unavailable");
    expect(profile.updateProfile).not.toHaveBeenCalled();
  });
});
