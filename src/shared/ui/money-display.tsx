import { cn } from "./utils";

export type MoneyDisplayVariant =
  | "income"
  | "expense"
  | "transfer"
  | "neutral";

export type MoneyDisplaySize = "sm" | "md" | "lg" | "xl";

export interface MoneyDisplayProps {
  amount: number;
  currency: string;
  variant?: MoneyDisplayVariant;
  size?: MoneyDisplaySize;
  className?: string;
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
  currency,
  variant = "neutral",
  size = "lg",
  className,
}: MoneyDisplayProps) {
  const formatted = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
  }).format(amount);

  return (
    <output
      role="status"
      className={cn(
        "font-mono tabular-nums",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {formatted}
    </output>
  );
}
