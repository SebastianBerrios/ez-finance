import type { SplitError } from "@/modules/splits/domain/split-error";
import { err, type Result } from "@shared/domain/result";

import type { SplitPort } from "./ports/split-port";

interface SettleSplitInput {
  readonly workspaceId: string;
  readonly splitId: string;
  /** Where the money lands. The person chooses — it need not be the account that paid. */
  readonly toAccountId: string;
  readonly occurredOn: string;
}

interface SettleSplitDeps {
  readonly splits: SplitPort;
}

/**
 * Someone paid you back.
 *
 * THE ACCOUNT IS A CHOICE, not the one the expense came from. Someone can pay you in
 * cash for something you put on a card, and forcing the original account would record
 * money arriving where it did not.
 *
 * Everything else is the RPC's job: it locks the row, refuses a second settlement, and
 * moves the money and stamps the row in one statement. This use case exists to keep
 * the blank-id checks off the round trip and the Postgres wording out of the UI.
 */
export async function settleSplit(
  input: SettleSplitInput,
  deps: SettleSplitDeps,
): Promise<Result<void, SplitError>> {
  if (input.workspaceId.trim().length === 0) {
    return err({ kind: "WorkspaceNotReady" });
  }

  // Both are NotPermitted rather than a "missing id" kind: from the caller's side an
  // id that names nothing and one that is not theirs are the same answer, and the RPC
  // conflates them too so ids cannot be probed.
  if (input.splitId.trim().length === 0) return err({ kind: "NotPermitted" });
  if (input.toAccountId.trim().length === 0) {
    return err({ kind: "AccountRequired" });
  }

  return deps.splits.settle(
    input.workspaceId,
    input.splitId,
    input.toAccountId,
    input.occurredOn,
  );
}
