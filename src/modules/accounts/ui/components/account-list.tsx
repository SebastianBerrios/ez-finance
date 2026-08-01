"use client";

import { useActionState } from "react";

import type { AccountWithBalance } from "@/modules/accounts/application/ports/account-port";
import { type Money, fromMinorUnits } from "@shared/domain/money";
import { expectOk } from "@shared/domain/result";
import { Button } from "@shared/ui/button";
import { MoneyDisplay } from "@shared/ui/money-display";

export interface ArchiveAccountState {
  error?: string;
  archived?: string;
  restored?: string;
}

type ArchiveActionFn = (
  prev: ArchiveAccountState,
  formData: FormData,
) => Promise<ArchiveAccountState>;

interface AccountListProps {
  action: ArchiveActionFn;
  accounts: readonly AccountWithBalance[];
}

const initialState: ArchiveAccountState = {};

/**
 * A balance as Money. A currency the app never writes means the row came from
 * outside any app path, so one bad row shows zero rather than taking the page down.
 */
function accountMoney(account: AccountWithBalance): Money {
  const money = fromMinorUnits(account.currency, account.balanceMinorUnits);
  return money.ok ? money.value : expectOk(fromMinorUnits("PEN", 0n));
}

/**
 * The accounts, each with its balance and a way in or out of circulation.
 *
 * ARCHIVED ACCOUNTS KEEP THEIR BALANCE ON SCREEN. The money is still there; a figure
 * that vanished on archive would read as the app having lost it, which is the single
 * worst thing a finance app can imply. They are marked instead, and offered a way
 * back.
 *
 * THE LAST ACTIVE ACCOUNT CANNOT BE ARCHIVED from here. Not a database rule — the
 * schema permits it — but a workspace with every account archived has nowhere to
 * record a movement, and the form that would tell you so is the one you can no longer
 * reach anything from. Better to refuse the step than to explain the dead end.
 */
export function AccountList({ action, accounts }: AccountListProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  const activeCount = accounts.filter((account) => !account.archived).length;

  return (
    <div className="flex flex-col gap-3">
      {state.error !== undefined && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {state.archived !== undefined && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          Archivamos «{state.archived}». Su saldo y su historia no cambian.
        </p>
      )}

      {state.restored !== undefined && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          «{state.restored}» vuelve a estar disponible.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {accounts.map((account) => {
          const isLastActive = !account.archived && activeCount === 1;

          return (
            <li
              key={account.id}
              className={
                account.archived
                  ? "border-border/60 flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-3"
                  : "border-border flex items-center justify-between gap-3 rounded-md border px-3 py-3"
              }
            >
              <span className="flex flex-col gap-1">
                <span className="text-foreground text-sm">
                  {account.name}
                  {account.archived && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      archivada
                    </span>
                  )}
                </span>
                <MoneyDisplay
                  amount={accountMoney(account)}
                  size="sm"
                  variant={
                    account.balanceMinorUnits < 0n ? "expense" : "neutral"
                  }
                />
              </span>

              <form action={formAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <input type="hidden" name="accountName" value={account.name} />
                <input
                  type="hidden"
                  name="intent"
                  value={account.archived ? "restore" : "archive"}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  disabled={isPending || isLastActive}
                  aria-label={`${account.archived ? "Restaurar" : "Archivar"} ${account.name}`}
                  title={
                    isLastActive
                      ? "Es tu única cuenta activa: sin ninguna no podrías registrar movimientos."
                      : undefined
                  }
                >
                  {account.archived ? "Restaurar" : "Archivar"}
                </Button>
              </form>
            </li>
          );
        })}
      </ul>

      {activeCount === 1 && (
        <p className="text-muted-foreground text-xs">
          Tu única cuenta activa no se puede archivar: sin ninguna no habría
          dónde registrar movimientos. Agrega otra primero.
        </p>
      )}
    </div>
  );
}
