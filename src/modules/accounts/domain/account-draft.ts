// account-draft.ts — the validated shape of an account about to be created.
//
// A DRAFT, not an Account: it carries what the person supplied, already checked,
// and deliberately has no id, no workspace and no balance. The id belongs to the
// database, the workspace to the session, and the balance is DERIVED (opening
// balance plus the account's movements) — spec §5.3, "el saldo de una cuenta se
// calcula, no se edita a mano". There is nowhere here to store a stale one.
import type { AccountType } from "@shared/domain/budget-types";
import { isSupportedCurrency, type CurrencyCode } from "@shared/domain/money";
import { err, ok, type Result } from "@shared/domain/result";

import type { AccountError } from "./account-error";

/**
 * The account types the ENGINE knows, listed here as values because
 * `AccountType` is a type and cannot be iterated at runtime.
 *
 * It must stay in step with AccountType in shared/domain/budget-types.ts and
 * with the CHECK on ez_finance.accounts.type. Drift is not cosmetic: the engine
 * derives `isSavings = type === 'savings'`, so an unrecognised value would be
 * silently budgeted as a non-savings account.
 */
const ACCOUNT_TYPES: readonly AccountType[] = [
  "cash",
  "bank",
  "card",
  "wallet",
  "investment",
  "savings",
  "receivable",
];

/**
 * Matches the length CHECK on ez_finance.accounts.name.
 *
 * Exported so renameAccount enforces the same limit without restating it: a rename and
 * a creation disagreeing about what a name may be is the kind of drift nobody notices
 * until one path rejects what the other accepted.
 */
export const NAME_MAX = 80;

export interface AccountDraft {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  /** Signed: a card account legitimately opens in the red. */
  readonly initialBalanceMinorUnits: bigint;
}

export interface AccountDraftInput {
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly initialBalanceMinorUnits: bigint;
}

function create(input: AccountDraftInput): Result<AccountDraft, AccountError> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    return err({ kind: "InvalidAccountName" });
  }

  const type = ACCOUNT_TYPES.find((candidate) => candidate === input.type);
  if (type === undefined) {
    return err({ kind: "InvalidAccountType" });
  }

  // Uppercased first: ISO 4217 codes are uppercase, and rejecting "ars" for
  // being lowercase would be a validation error about nothing.
  const currency = input.currency.trim().toUpperCase();
  if (!isSupportedCurrency(currency)) {
    return err({ kind: "UnsupportedCurrency" });
  }

  return ok(
    Object.freeze({
      name,
      type,
      currency,
      initialBalanceMinorUnits: input.initialBalanceMinorUnits,
    }),
  );
}

export const accountDraft = { create } as const;
