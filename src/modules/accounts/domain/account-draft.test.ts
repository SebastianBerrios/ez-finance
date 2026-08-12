import { describe, expect, it } from "vitest";

import { accountDraft } from "./account-draft";

const VALID = {
  name: "Efectivo",
  type: "cash",
  currency: "PEN",
  initialBalanceMinorUnits: 0n,
} as const;

describe("accountDraft.create", () => {
  it("accepts a well-formed draft", () => {
    const result = accountDraft.create(VALID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Efectivo");
      expect(result.value.type).toBe("cash");
      expect(result.value.currency).toBe("PEN");
      expect(result.value.initialBalanceMinorUnits).toBe(0n);
    }
  });

  it.each(["cash", "bank", "card", "wallet", "investment", "savings"])(
    "accepts the '%s' account type",
    (type) => {
      expect(accountDraft.create({ ...VALID, type }).ok).toBe(true);
    },
  );

  it("accepts `receivable`, the split-expense account type", () => {
    // Three places have to agree about this set — this list, AccountType in
    // shared/domain/budget-types.ts, and the CHECK on ez_finance.accounts.type — and
    // the file's own comment says the drift is not cosmetic: the engine derives
    // isSavings from the string, so a value one layer accepts and another does not is
    // a row that gets budgeted wrong rather than rejected.
    //
    // It is NOT offered in the account form on purpose (see account-form.tsx): the
    // "Por cobrar" account is created by the split flow, not by hand.
    const result = accountDraft.create({ ...VALID, type: "receivable" });

    expect(result.ok).toBe(true);
  });

  it("rejects a type the engine does not know", () => {
    // The engine derives isSavings from this exact string set; anything else
    // would be silently treated as non-savings.
    const result = accountDraft.create({ ...VALID, type: "crypto" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAccountType");
  });

  it("trims the name", () => {
    const result = accountDraft.create({ ...VALID, name: "  Banco  " });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Banco");
  });

  it.each(["", "   "])("rejects a blank name (%j)", (name) => {
    const result = accountDraft.create({ ...VALID, name });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAccountName");
  });

  it("rejects a name longer than the column allows", () => {
    // 80 is the CHECK in the accounts table; failing here beats a 500 from PG.
    const result = accountDraft.create({ ...VALID, name: "x".repeat(81) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidAccountName");
  });

  it("accepts a name of exactly the maximum length", () => {
    expect(accountDraft.create({ ...VALID, name: "x".repeat(80) }).ok).toBe(
      true,
    );
  });

  it("rejects an unsupported currency", () => {
    const result = accountDraft.create({ ...VALID, currency: "XYZ" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("UnsupportedCurrency");
  });

  it("rejects ARS — a REAL currency the product does not support", () => {
    // The product operates in PEN. Other currencies exist in
    // shared/domain/money.ts only because the arithmetic is tested against
    // differing exponents, so "supported by Money" is NOT the same as "offered
    // by the app" — and a currency nobody added is refused rather than assumed.
    //
    // Note the DB is MORE permissive: accounts.currency is a bare char(3) with
    // no whitelist, so this domain check is the only gate. A direct SQL insert
    // would create an account the engine cannot price.
    const result = accountDraft.create({ ...VALID, currency: "ARS" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("UnsupportedCurrency");
  });

  it("uppercases the currency before validating it", () => {
    const result = accountDraft.create({ ...VALID, currency: "pen" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.currency).toBe("PEN");
  });

  it("accepts a NEGATIVE opening balance", () => {
    // A credit card legitimately starts in the red. The column is a signed
    // bigint precisely so this is representable.
    const result = accountDraft.create({
      ...VALID,
      type: "card",
      initialBalanceMinorUnits: -250000n,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.initialBalanceMinorUnits).toBe(-250000n);
  });
});
