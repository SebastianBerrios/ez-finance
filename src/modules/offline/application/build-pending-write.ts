import {
  pendingWrite,
  type PendingKind,
  type PendingWrite,
  type PendingWriteError,
} from "@/modules/offline/domain/pending-write";
import type { Result } from "@shared/domain/result";

/**
 * The form fields a queued movement carries — and nothing else.
 *
 * AN EXPLICIT LIST, not "everything in the FormData". A form gains fields over time
 * (a UI toggle, a CSRF token, whatever a component adds), and iterating would quietly
 * start shipping them to the sync route, which reads exactly these names. The list is
 * the contract between the form and that route, so it is written down once.
 */
const CARRIED = [
  "kind",
  "amount",
  "accountId",
  "categoryId",
  "occurredOn",
  "note",
  "transactionId",
] as const;

export interface BuildPendingWriteInput {
  readonly localId: string;
  readonly kind: PendingKind;
  readonly workspaceId: string;
  readonly queuedAt: number;
  readonly form: FormData;
  readonly baseUpdatedAt?: string;
}

/**
 * A queued write, built from the form the person just submitted.
 *
 * The values are copied VERBATIM: no trimming, no parsing, no normalising. The same
 * server use case that validates an online submit validates this one when it arrives, and
 * anything cleaned up here would be a rule enforced in only one of the two paths — which
 * is how an offline path becomes a laxer door into the database.
 */
export function pendingWriteFrom(
  input: BuildPendingWriteInput,
): Result<PendingWrite, PendingWriteError> {
  const fields: Record<string, string> = {};

  for (const name of CARRIED) {
    const value = input.form.get(name);
    if (typeof value === "string") fields[name] = value;
  }

  return pendingWrite.create({
    localId: input.localId,
    kind: input.kind,
    workspaceId: input.workspaceId,
    queuedAt: input.queuedAt,
    fields,
    ...(input.baseUpdatedAt === undefined
      ? {}
      : { baseUpdatedAt: input.baseUpdatedAt }),
  });
}
