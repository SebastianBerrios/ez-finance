// budget-types.ts — read-only snapshot input types and result types for the budget domain
// Types ONLY — no runtime executable code (no functions, no classes, no statements)
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type { CurrencyCode, Money } from "./money";

// ---------------------------------------------------------------------------
// TransactionKind / Bucket / AccountType / misc
// ---------------------------------------------------------------------------

export type TransactionKind = "income" | "expense" | "transfer";

/** 50/30/20 budget buckets */
export type Bucket = "need" | "want" | "save";

export type AccountType =
  | "cash"
  | "bank"
  | "card"
  | "wallet"
  | "investment"
  | "savings";

/** Which leg of a transfer pair this row represents */
export type TransferLeg = "out" | "in";

export type IncomeMode = "mayor" | "real" | "esperado";

// ---------------------------------------------------------------------------
// Snapshot shapes (read-only inputs to the engine)
// ---------------------------------------------------------------------------

export interface SnapshotAccount {
  readonly id: string;
  readonly type: AccountType; // engine derives isSavings = type === 'savings'
}

export interface SnapshotCategory {
  readonly id: string;
  readonly bucket: Bucket | null; // null = unbucketed edge case
  readonly archived: boolean; // archived categories STILL COUNT
  readonly parentId?: string; // exactOptionalPropertyTypes: omit or provide, never undefined value
}

export interface SnapshotTransaction {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly amount: Money; // POSITIVE magnitude, workspace base currency
  readonly date: string; // 'YYYY-MM-DD' workspace-local date-only
  readonly accountId: string;
  readonly categoryId?: string; // present for income/expense; omitted for transfer legs
  readonly transferId?: string; // present ONLY on transfer legs; links the pair
  readonly transferLeg?: TransferLeg; // 'out' | 'in'; present ONLY on transfer legs
  readonly counterAccountId?: string; // the OTHER account in the transfer (present on transfer legs)
}

export interface MonthlySnapshot {
  readonly year: number;
  readonly month: number; // 1-12
  readonly baseCurrency: CurrencyCode; // all amounts already in this currency
  readonly transactions: readonly SnapshotTransaction[];
  readonly categories: readonly SnapshotCategory[];
  readonly accounts: readonly SnapshotAccount[];
}

// ---------------------------------------------------------------------------
// BudgetConfig
// ---------------------------------------------------------------------------

export interface BudgetConfig {
  readonly incomeMode: IncomeMode;
  readonly expectedIncome: Money;
  readonly percentages: {
    readonly need: number;
    readonly want: number;
    readonly save: number;
  }; // must sum to 100, all >= 0
  readonly nearLimitThresholdPct?: number; // default 80
  readonly categoryLimits?: readonly {
    readonly categoryId: string;
    readonly limit: Money;
  }[];
}

// ---------------------------------------------------------------------------
// Budget result types
// ---------------------------------------------------------------------------

export interface BucketResult {
  readonly targetAmount: Money; // income * pct / 100 (half-even via multiplyByRate)
  readonly consumedAmount: Money;
  readonly consumedPct: number; // 0 when income is zero (guard) — never NaN
  readonly remaining: Money; // target - consumed (may be negative)
}

export interface BudgetResult {
  readonly incomeUsed: Money;
  readonly buckets: {
    readonly need: BucketResult;
    readonly want: BucketResult;
    readonly save: BucketResult;
  };
  readonly globalAvailable: Money; // income - sum(consumed of all buckets)
  readonly savingsAmount: Money; // save-bucket expenses + outgoing transfers to savings accounts
  readonly alerts: readonly Alert[];
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertLevel = "near" | "over";

export interface Alert {
  readonly scope: "bucket" | "category";
  readonly level: AlertLevel;
  readonly bucket?: Bucket;
  readonly categoryId?: string;
  readonly consumedPct: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ConfigError {
  readonly kind: "ConfigError";
  readonly reason:
    | "percentages-not-100"
    | "percentage-negative"
    | "percentage-not-integer"
    | "income-currency-mismatch"
    | "currency-mismatch";
  readonly detail?: string;
}
