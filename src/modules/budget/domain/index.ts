// index.ts — public API barrel for src/modules/budget/domain
// Exports ONLY the public surface: computeBudget + public result/config types.
// Sub-functions (validateConfig, resolveIncome, classify, computeSavings,
// computeBucket, generateAlerts) are internal — NOT re-exported here.

export { computeBudget } from "./budget-engine";
export type {
  Alert,
  AlertLevel,
  BucketResult,
  BudgetConfig,
  BudgetResult,
  ConfigError,
} from "@shared/domain/budget-types";
