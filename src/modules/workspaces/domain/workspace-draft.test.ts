import { describe, expect, it } from "vitest";

import { NAME_MAX, workspaceDraft } from "./workspace-draft";

describe("workspaceDraft", () => {
  it("accepts a name", () => {
    const result = workspaceDraft({ name: "Negocio" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: "Negocio" });
  });

  it("trims surrounding whitespace", () => {
    const result = workspaceDraft({ name: "  Negocio  " });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Negocio");
  });

  it("refuses a name that is empty or only whitespace", () => {
    for (const name of ["", "   ", "\t\n"]) {
      const result = workspaceDraft({ name });

      expect(result.ok, `"${name}" must be refused`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("NameRequired");
    }
  });

  it("refuses a name longer than the RPC allows", () => {
    const result = workspaceDraft({ name: "a".repeat(NAME_MAX + 1) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NameTooLong");
  });

  it("accepts a name at exactly the limit", () => {
    expect(workspaceDraft({ name: "a".repeat(NAME_MAX) }).ok).toBe(true);
  });

  it("measures the limit AFTER trimming", () => {
    // The RPC compares length(btrim(name)), so padding a valid name with spaces must
    // not be rejected here for a length the stored value never has.
    const result = workspaceDraft({ name: `  ${"a".repeat(NAME_MAX)}  ` });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name.length).toBe(NAME_MAX);
  });
});
