// The door a queued offline write comes back through.
//
// WHY A ROUTE HANDLER AND NOT THE SERVER ACTIONS. An action is invoked by a form
// submission the browser is making right now; a queued write is replayed later, one at a
// time, in an order the client controls, and each one needs an ANSWER richer than "ok or
// this error" — the merge rule has to report whether it overwrote something. That is a
// request/response shape, which is what a route handler is.
//
// It reuses the same use cases as the forms, so the offline path is not a second, laxer
// door into the database: same validation, same RLS, same error messages.
import { NextResponse } from "next/server";

// Through the module's application seam, never its domain: see sync-contract.ts.
import {
  resolveEdit,
  type SyncOutcome,
} from "@/modules/offline/application/sync-contract";
import { editMovement } from "@/modules/transactions/application/edit-movement";
import { recordTransaction } from "@/modules/transactions/application/record-transaction";
import { SupabaseTransactionAdapter } from "@/modules/transactions/infrastructure/supabase-transaction-adapter";
import { transactionErrorMessage } from "@/modules/transactions/ui/transaction-error-message";
import { getAuthenticatedUser } from "@/shared/infrastructure/supabase/current-user";
import { parseAmountToMinorUnits } from "@shared/domain/money-input";

const MINOR_UNIT_EXPONENT = 2;

interface SyncRequest {
  readonly kind?: unknown;
  readonly workspaceId?: unknown;
  readonly fields?: unknown;
  readonly baseUpdatedAt?: unknown;
}

function field(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  return typeof value === "string" ? value : "";
}

function rejected(reason: string): NextResponse {
  return NextResponse.json({ outcome: { kind: "Rejected", reason } });
}

function answer(outcome: SyncOutcome): NextResponse {
  return NextResponse.json({ outcome });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { user } = await getAuthenticatedUser();

  // NOT retryable, deliberately. A queue that keeps re-sending against a dead session
  // would drain into nothing and the person would never be told to sign in again.
  if (!user) {
    return rejected(
      "tu sesión expiró. Ingresá de nuevo y volvé a registrarlo.",
    );
  }

  let body: SyncRequest;
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    return rejected("no pudimos leer el movimiento guardado.");
  }

  const kind = body.kind === "edit" ? "edit" : "record";

  /*
    THE WORKSPACE COMES FROM THE WRITE, not from the currently selected space, and that
    is the correct call rather than a shortcut: the person may have switched spaces
    between recording offline and reconnecting, and the movement belongs to the space it
    was recorded in. Trusting the body is safe because it is not the guard — RLS scopes
    every statement to the caller's memberships, so a workspace that is not theirs
    matches no rows and the use case reports NotPermitted.
  */
  const workspaceId =
    typeof body.workspaceId === "string" ? body.workspaceId : "";
  if (workspaceId.length === 0) {
    return rejected("el movimiento guardado no dice a qué espacio pertenece.");
  }

  const fields =
    typeof body.fields === "object" && body.fields !== null
      ? (body.fields as Record<string, unknown>)
      : {};

  const amount = parseAmountToMinorUnits(
    field(fields, "amount"),
    MINOR_UNIT_EXPONENT,
  );

  if (!amount.ok) {
    return rejected(
      amount.error.kind === "TooManyDecimals"
        ? "el monto puede tener como máximo dos decimales."
        : "el monto no es un número válido.",
    );
  }

  const transactions = new SupabaseTransactionAdapter();

  if (kind === "record") {
    const result = await recordTransaction(
      {
        workspaceId,
        // From the SESSION, never from the body: RLS requires created_by = auth.uid(),
        // and a queued write must not be able to claim another author.
        authorId: user.id,
        kind: field(fields, "kind"),
        baseAmountMinorUnits: amount.value,
        occurredOn: field(fields, "occurredOn"),
        accountId: field(fields, "accountId"),
        categoryId: field(fields, "categoryId"),
        note: field(fields, "note"),
      },
      { transactions },
    );

    return result.ok
      ? answer({ kind: "Applied" })
      : rejected(transactionErrorMessage(result.error, "record"));
  }

  const transactionId = field(fields, "transactionId");
  const baseUpdatedAt =
    typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : "";

  if (transactionId.length === 0 || baseUpdatedAt.length === 0) {
    return rejected("el cambio guardado no dice qué movimiento corrige.");
  }

  /*
    READ BEFORE WRITE, and only to decide what to TELL the person.
    The write happens either way — last write wins is the rule the person chose — so this
    is not a compare-and-swap. It answers two questions: is there still a row (a movement
    deleted meanwhile must not be resurrected), and did it change since the form opened
    (in which case the person is told their phone's version replaced it).
  */
  const current = await transactions.findEditable(
    workspaceId,
    transactionId,
    user.id,
  );

  if (!current.ok) {
    if (current.error.kind === "UnknownReference") {
      return answer({ kind: "Vanished" });
    }
    return rejected(transactionErrorMessage(current.error, "edit"));
  }

  const verdict = resolveEdit({
    baseUpdatedAt,
    currentUpdatedAt: current.value.updatedAt,
  });

  const result = await editMovement(
    {
      workspaceId,
      transactionId,
      // A transfer leg is not editable at all, and findEditable already refused one
      // above — so there is never a transfer to re-pair here.
      transferId: null,
      kind: field(fields, "kind"),
      baseAmountMinorUnits: amount.value,
      occurredOn: field(fields, "occurredOn"),
      accountId: field(fields, "accountId"),
      categoryId: field(fields, "categoryId"),
      note: field(fields, "note"),
    },
    { transactions },
  );

  return result.ok
    ? answer(verdict)
    : rejected(transactionErrorMessage(result.error, "edit"));
}
