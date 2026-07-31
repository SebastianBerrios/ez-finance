// onboarding-status.ts — "is this workspace configured enough to use?"
//
// Read directly by the (app) layout, mirroring bootstrapUserWorkspace(): there is
// no domain rule and no orchestration here, only a question about stored state, so
// a port and a use case would be ceremony around a boolean.
//
// NOTHING IS PERSISTED ABOUT PROGRESS. Onboarding completeness is DERIVED from
// what exists, so abandoning the wizard halfway resumes where it stopped, and a
// "step" column can never disagree with reality.
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export interface OnboardingStatus {
  /** The workspace has at least one account, so its base currency is fixed. */
  readonly hasAccount: boolean;
  /** A budget config governs the current month. */
  readonly hasBudgetConfig: boolean;
  readonly complete: boolean;
}

const INCOMPLETE: OnboardingStatus = Object.freeze({
  hasAccount: false,
  hasBudgetConfig: false,
  complete: false,
});

/** Today as YYYY-MM-DD; budget_config_for truncates it to the month. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function readOnboardingStatus(
  workspaceId: string,
): Promise<OnboardingStatus> {
  try {
    const supabase = await createServerClient();

    // NOT filtered on archived_at, on purpose. What this step establishes is the
    // workspace's base currency, and that is permanent — someone who archived
    // their only account has still made the choice, so sending them back would
    // ask a question that can no longer be answered.
    const accounts = await supabase
      .from("accounts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1);

    const config = await supabase.rpc("budget_config_for", {
      p_workspace_id: workspaceId,
      p_month: todayIsoDate(),
    });

    // A FAILED read reports incomplete rather than complete. Onboarding is
    // idempotent and re-runnable; a dashboard with no config is a dead end that
    // renders nothing and explains nothing. When unsure, send them somewhere
    // that works.
    if (accounts.error || config.error) return INCOMPLETE;

    const hasAccount = (accounts.data ?? []).length > 0;
    const hasBudgetConfig = ((config.data ?? []) as unknown[]).length > 0;

    return {
      hasAccount,
      hasBudgetConfig,
      complete: hasAccount && hasBudgetConfig,
    };
  } catch {
    return INCOMPLETE;
  }
}
