import { describe, expect, it } from "vitest";

import { resolveEdit, syncOutcome } from "./sync-outcome";

describe("resolveEdit — last write wins, and it says so", () => {
  it("applies cleanly when nothing else touched the row", () => {
    const outcome = resolveEdit({
      baseUpdatedAt: "2026-08-12T10:00:00Z",
      currentUpdatedAt: "2026-08-12T10:00:00Z",
    });

    expect(outcome.kind).toBe("Applied");
  });

  it("STILL APPLIES when the row changed, and reports that it overwrote", () => {
    // This is the whole decision. The write is not rejected and no merge screen
    // appears: the person's phone is the last word. What it must never be is SILENT —
    // someone whose correction disappeared without a word concludes the app lost it.
    const outcome = resolveEdit({
      baseUpdatedAt: "2026-08-12T10:00:00Z",
      currentUpdatedAt: "2026-08-12T11:30:00Z",
    });

    expect(outcome.kind).toBe("AppliedOverwriting");
  });

  it("treats a row that no longer exists as gone, not as a conflict", () => {
    // Deleted while the phone was offline. Re-creating it would resurrect something
    // the person deliberately removed, so the write is dropped and reported.
    const outcome = resolveEdit({
      baseUpdatedAt: "2026-08-12T10:00:00Z",
      currentUpdatedAt: null,
    });

    expect(outcome.kind).toBe("Vanished");
  });

  it("reports overwriting even when the row moved BACKWARDS in time", () => {
    // Never compares which timestamp is newer, only whether it is the SAME version.
    // Clocks disagree across devices, and "is it different" is answerable where "is it
    // newer" is a guess.
    const outcome = resolveEdit({
      baseUpdatedAt: "2026-08-12T11:30:00Z",
      currentUpdatedAt: "2026-08-12T10:00:00Z",
    });

    expect(outcome.kind).toBe("AppliedOverwriting");
  });
});

describe("syncOutcome.retryable", () => {
  it("retries a transport failure — the network is not the person's mistake", () => {
    expect(syncOutcome.retryable({ kind: "Unreachable" })).toBe(true);
  });

  it("does NOT retry a refusal", () => {
    // A refused write will be refused identically forever, and everything behind it in
    // the queue waits. It has to be surfaced and dropped instead.
    expect(
      syncOutcome.retryable({
        kind: "Rejected",
        reason: "El monto tiene que ser mayor que cero.",
      }),
    ).toBe(false);
  });

  it("does not retry what already landed", () => {
    expect(syncOutcome.retryable({ kind: "Applied" })).toBe(false);
    expect(syncOutcome.retryable({ kind: "AppliedOverwriting" })).toBe(false);
    expect(syncOutcome.retryable({ kind: "Vanished" })).toBe(false);
  });
});

describe("syncOutcome.notice", () => {
  it("says nothing when everything applied cleanly", () => {
    // Silence is the correct report for the ordinary case: a banner after every
    // reconnect trains people to dismiss banners.
    expect(
      syncOutcome.notice([{ kind: "Applied" }, { kind: "Applied" }]),
    ).toBeNull();
  });

  it("names how many movements arrived when something was overwritten", () => {
    const notice = syncOutcome.notice([
      { kind: "Applied" },
      { kind: "AppliedOverwriting" },
    ]);

    expect(notice).not.toBeNull();
    expect(notice).toContain("2");
  });

  it("surfaces a refusal, because only the person can fix it", () => {
    const notice = syncOutcome.notice([
      { kind: "Rejected", reason: "Elige una fecha válida." },
    ]);

    expect(notice).toContain("Elige una fecha válida.");
  });

  it("reports a vanished row plainly", () => {
    const notice = syncOutcome.notice([{ kind: "Vanished" }]);

    expect(notice).not.toBeNull();
  });
});
