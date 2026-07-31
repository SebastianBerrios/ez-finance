import type { BucketResult } from "@shared/domain/budget-types";
import { MoneyDisplay } from "@shared/ui/money-display";

interface BucketCardProps {
  label: string;
  /** The share of income this bucket gets, e.g. 50. */
  percentage: number;
  result: BucketResult;
}

/**
 * One of the three buckets.
 *
 * READABILITY OF THE AMOUNT IS THE FIRST PRIORITY (spec §1), so the remaining
 * figure is the largest thing here and everything else is context around it. What
 * the person actually needs is "how much can I still spend", not "what percentage
 * have I used" — the percentage is the bar, the money is the headline.
 */
export function BucketCard({ label, percentage, result }: BucketCardProps) {
  const over = result.remaining.minorUnits < 0n;

  // The bar is capped at 100 for LAYOUT only; the percentage text is not, because
  // the engine legitimately reports over 100 % and hiding that would be the one
  // thing a budget must never do.
  const barWidth = Math.min(result.consumedPct, 100);

  return (
    <section className="bg-card border-border rounded-xl border p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-foreground text-sm font-medium">{label}</h3>
        <span className="text-muted-foreground text-xs">{percentage}%</span>
      </div>

      <p className="mt-3">
        <span
          className={
            over
              ? "text-destructive text-2xl font-bold"
              : "text-foreground text-2xl font-bold"
          }
        >
          <MoneyDisplay amount={result.remaining} size="lg" />
        </span>
        <span className="text-muted-foreground ml-2 text-xs">
          {over ? "de más" : "disponible"}
        </span>
      </p>

      <div
        className="bg-muted mt-4 h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={result.consumedPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${result.consumedPct}% consumido`}
      >
        <div
          className={over ? "bg-destructive h-full" : "bg-primary h-full"}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        Usaste <MoneyDisplay amount={result.consumedAmount} /> de{" "}
        <MoneyDisplay amount={result.targetAmount} /> ({result.consumedPct}%)
      </p>
    </section>
  );
}
