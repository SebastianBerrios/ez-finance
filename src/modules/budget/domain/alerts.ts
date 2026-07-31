// alerts.ts — pure domain: generate budget alerts from bucket and category data
// exactOptionalPropertyTypes + noUncheckedIndexedAccess are ON

import type {
  Alert,
  BudgetConfig,
  BudgetResult,
  Bucket,
} from "@shared/domain/budget-types";
import { isZero } from "@shared/domain/money";
import type { Classified } from "./transfer-classifier";

// ---------------------------------------------------------------------------
// generateAlerts
// ---------------------------------------------------------------------------

/**
 * Generate budget alerts from computed bucket results and optional category limits.
 *
 * Bucket-level alert rules (per locked decisions):
 *   - consumedPct > 100         → ONLY over-limit (not near+over — reduces noise)
 *   - consumedPct >= threshold AND <= 100 → near-limit
 *   - below threshold           → no alert
 *   Exactly 100% → near-limit only (over-limit is strictly > 100).
 *
 * Category-level alerts: same rules applied against consumed/limit percentage.
 *
 * Returns Alert[] — pure data, no side effects.
 */
export function generateAlerts(
  result: Pick<BudgetResult, "buckets">,
  classified: Classified,
  config: BudgetConfig,
): Alert[] {
  const threshold = config.nearLimitThresholdPct ?? 80;
  const alerts: Alert[] = [];

  // ------------------------------------------------------------------
  // Bucket-level alerts
  // ------------------------------------------------------------------

  const bucketNames: Bucket[] = ["need", "want", "save"];
  for (const bucket of bucketNames) {
    const pct = result.buckets[bucket].consumedPct;

    if (pct > 100) {
      // LOCKED: only over-limit when > 100 (never near+over)
      alerts.push({ scope: "bucket", level: "over", bucket, consumedPct: pct });
    } else if (pct >= threshold) {
      // Near-limit when >= threshold AND <= 100 (exactly 100 = near, not over)
      alerts.push({ scope: "bucket", level: "near", bucket, consumedPct: pct });
    }
    // Below threshold: no alert
  }

  // ------------------------------------------------------------------
  // Category-level alerts (optional; only when categoryLimits is configured)
  // ------------------------------------------------------------------

  if (
    config.categoryLimits === undefined ||
    config.categoryLimits.length === 0
  ) {
    return alerts;
  }

  for (const { categoryId, limit } of config.categoryLimits) {
    const consumed = classified.expenseByCategory.get(categoryId);
    if (consumed === undefined) continue; // no spending against this category

    // Compute consumed percentage against the category limit
    if (isZero(limit)) continue; // zero limit is undefined behavior — skip

    const pct = (Number(consumed.minorUnits) * 100) / Number(limit.minorUnits);

    if (pct > 100) {
      alerts.push({
        scope: "category",
        level: "over",
        categoryId,
        consumedPct: pct,
      });
    } else if (pct >= threshold) {
      alerts.push({
        scope: "category",
        level: "near",
        categoryId,
        consumedPct: pct,
      });
    }
  }

  return alerts;
}
