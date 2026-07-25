// supabase-deletion-adapter.ts — implements DeletionPort over the ez_finance
// deletion RPCs (migration 20260725120000_ez_finance_account_deletion.sql).
//
// SCOPED DELETION: none of these RPCs touch auth.users. mvp-lab is a shared
// project, so "deleting the account" erases ez_finance data only; the shared
// identity row survives for the other apps. See the migration header.
//
// The RPCs derive the user from auth.uid(), so the `userId` argument is only
// the caller's assertion of who is logged in — it is never sent. The session
// cookie is the authority, which is what keeps the port honest against a
// forged id.
import {
  type DeletionPort,
  type DeletionStatus,
} from "@/modules/auth/application/ports/deletion-port";
import { type AuthError } from "@/modules/auth/domain/auth-error";
import { GracePeriod } from "@/modules/auth/domain/grace-period";
import { type Result, err, ok } from "@/shared/domain/result";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

import { mapSupabaseError } from "./error-map";

// jsonb payloads returned by the RPCs.
interface DeletionStatePayload {
  state?: unknown;
  requested_at?: unknown;
  ends_at?: unknown;
  finalized_at?: unknown;
}

/** Parse a timestamptz string; null when absent or not a real date. */
function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Build a GracePeriod from a persisted window. Returns null when either
 * boundary is missing or unparseable — the caller maps that to Unavailable
 * rather than inventing a deadline.
 */
function parseWindow(payload: DeletionStatePayload): GracePeriod | null {
  const requestedAt = parseTimestamp(payload.requested_at);
  const endsAt = parseTimestamp(payload.ends_at);
  if (requestedAt === null || endsAt === null) return null;
  return GracePeriod.between(requestedAt, endsAt);
}

export class SupabaseDeletionAdapter implements DeletionPort {
  async getState(_userId: string): Promise<Result<DeletionStatus, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase.rpc("deletion_state");

      if (error) return err(mapSupabaseError(error));
      if (!data) return err({ kind: "Unavailable" });

      const payload = data as DeletionStatePayload;

      if (payload.state === "DELETED") {
        // Terminal. finalized_at is decoration, so an unparseable timestamp
        // must NOT downgrade this to an error: failing here would send the
        // caller back down the bootstrap path and silently re-provision the
        // account whose data was just erased.
        const finalizedAt = parseTimestamp(payload.finalized_at);
        return ok(
          finalizedAt === null
            ? { state: "DELETED" }
            : { state: "DELETED", finalizedAt },
        );
      }

      if (payload.state === "ACTIVE") {
        return ok({ state: "ACTIVE" });
      }

      if (payload.state === "GRACE_PERIOD") {
        const grace = parseWindow(payload);
        if (grace === null) return err({ kind: "Unavailable" });
        return ok({ state: "GRACE_PERIOD", grace });
      }

      // Unknown state value: fail closed rather than guessing ACTIVE, which
      // would hide a pending deletion from the user.
      return err({ kind: "Unavailable" });
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  async request(_userId: string): Promise<Result<GracePeriod, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase.rpc("request_account_deletion");

      if (error) return err(mapSupabaseError(error));
      if (!data) return err({ kind: "Unavailable" });

      const grace = parseWindow(data as DeletionStatePayload);
      if (grace === null) return err({ kind: "Unavailable" });

      return ok(grace);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  async cancel(_userId: string): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.rpc("cancel_account_deletion");

      if (error) return err(mapSupabaseError(error));
      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }

  async acknowledge(_userId: string): Promise<Result<void, AuthError>> {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.rpc("acknowledge_deletion");

      if (error) return err(mapSupabaseError(error));
      return ok(undefined);
    } catch (e) {
      return err(mapSupabaseError(e));
    }
  }
}
