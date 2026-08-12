"use client";

import type {
  AccountOption,
  CategoryOption,
  TransactionFormInitialValues,
  TransactionFormState,
} from "@/modules/transactions/ui/components/transaction-form";
import { TransactionForm } from "@/modules/transactions/ui/components/transaction-form";

import { queueWrite } from "../../offline-queue";

/**
 * The movement form, wired to the offline queue.
 *
 * WHY A CONTAINER AND NOT A PROP ON THE PAGE. The queue is IndexedDB — it only exists in
 * the browser — so whatever supplies it has to be a client component, and a Server
 * Component cannot pass a function across the boundary. This is the smallest thing that
 * can be one: it turns the workspace id into an `enqueue` and hands it down.
 *
 * Used by BOTH the new-movement and the edit screens, because the offline story is the
 * same for both: the write waits on the device and lands in the order it was made.
 */
interface OfflineTransactionFormProps {
  action: (
    prev: TransactionFormState,
    formData: FormData,
  ) => Promise<TransactionFormState>;
  accounts: readonly AccountOption[];
  categories: readonly CategoryOption[];
  currencyLabel: string;
  today: string;
  /** The space the write belongs to — NOT re-resolved at drain time. See the route. */
  workspaceId: string;
  initial?: TransactionFormInitialValues;
  submitLabel?: string;
  /**
   * The row's `updated_at` when this form was rendered. Required when editing: it is what
   * lets the sync route say "your phone's version replaced a change made meanwhile"
   * instead of replacing it in silence.
   */
  baseUpdatedAt?: string;
}

export function OfflineTransactionForm({
  action,
  accounts,
  categories,
  currencyLabel,
  today,
  workspaceId,
  initial,
  submitLabel,
  baseUpdatedAt,
}: OfflineTransactionFormProps) {
  return (
    <TransactionForm
      action={action}
      accounts={accounts}
      categories={categories}
      currencyLabel={currencyLabel}
      today={today}
      {...(initial === undefined ? {} : { initial })}
      {...(submitLabel === undefined ? {} : { submitLabel })}
      offline={{
        enqueue: (form) =>
          queueWrite({
            form,
            kind: initial === undefined ? "record" : "edit",
            workspaceId,
            ...(baseUpdatedAt === undefined ? {} : { baseUpdatedAt }),
          }),
      }}
    />
  );
}
