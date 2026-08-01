import { describe, expect, it } from "vitest";

import { categoryDraft, NAME_MAX } from "./category-draft";

describe("categoryDraft", () => {
  it("accepts a name and one of the three buckets", () => {
    const result = categoryDraft({ name: "Mascotas", bucket: "need" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "Mascotas", bucket: "need" });
    }
  });

  it("trims surrounding whitespace before storing", () => {
    const result = categoryDraft({ name: "  Gimnasio  ", bucket: "want" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Gimnasio");
  });

  it("refuses a name that is empty or only whitespace", () => {
    for (const name of ["", "   ", "\t\n"]) {
      const result = categoryDraft({ name, bucket: "need" });

      expect(result.ok, `"${name}" must be refused`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("NameRequired");
    }
  });

  it("refuses a name longer than the column allows", () => {
    // Checked against the limit rather than a magic number, so the test moves
    // with the schema instead of quietly passing when it changes.
    const result = categoryDraft({
      name: "a".repeat(NAME_MAX + 1),
      bucket: "need",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameTooLong");
  });

  it("accepts a name at exactly the limit", () => {
    const result = categoryDraft({
      name: "a".repeat(NAME_MAX),
      bucket: "save",
    });

    expect(result.ok).toBe(true);
  });

  it("measures the limit AFTER trimming", () => {
    // Otherwise padding a valid name with spaces would be rejected for a length
    // the stored value never has.
    const result = categoryDraft({
      name: `  ${"a".repeat(NAME_MAX)}  `,
      bucket: "save",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name.length).toBe(NAME_MAX);
  });

  it("refuses anything that is not one of the engine's three buckets", () => {
    // A category with NO bucket lands in no bucket at all and is invisible to the
    // 50/30/20 split, so setup must never be able to create one by accident. The
    // empty string is what an untouched <select> submits.
    for (const bucket of ["", "needs", "NEED", "otro", "null"]) {
      const result = categoryDraft({ name: "Mascotas", bucket });

      expect(result.ok, `"${bucket}" must be refused`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("InvalidBucket");
    }
  });

  it("reports the NAME problem first when both are wrong", () => {
    // Stable ordering so the person fixes one thing at a time and the message is
    // never a lottery between two real faults.
    const result = categoryDraft({ name: "", bucket: "nope" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameRequired");
  });
});
