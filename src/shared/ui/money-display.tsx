import { toParts } from "@shared/domain/money";
import type { Money } from "@shared/domain/money";

import { cn } from "./utils";

export type MoneyDisplayVariant = "income" | "expense" | "transfer" | "neutral";

export type MoneyDisplaySize = "sm" | "md" | "lg" | "xl";

export interface MoneyDisplayProps {
  amount: Money; // was: amount: number; currency: string
  variant?: MoneyDisplayVariant;
  size?: MoneyDisplaySize;
  className?: string;
  locale?: string; // default 'es-ES'
}

const variantClasses: Record<MoneyDisplayVariant, string> = {
  income: "text-income",
  expense: "text-expense",
  transfer: "text-transfer",
  neutral: "",
};

const sizeClasses: Record<MoneyDisplaySize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-2xl",
  xl: "text-4xl",
};

export function MoneyDisplay({
  amount,
  variant = "neutral",
  size = "lg",
  className,
  locale,
}: MoneyDisplayProps) {
  // Intl formatting stays in the UI layer only — domain is Intl-free
  const { currency, exponent, minorUnits } = toParts(amount);
  // display-only float: domain never does this arithmetic
  const value = Number(minorUnits) / 10 ** exponent;
  const formatted = new Intl.NumberFormat(locale ?? "es-ES", {
    style: "currency",
    currency,
  }).format(value);

  return (
    <output
      role="status"
      className={cn(
        "font-mono tabular-nums",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {formatted}
    </output>
  );
}
