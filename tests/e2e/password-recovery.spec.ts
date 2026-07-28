// Password recovery end-to-end: does the emailed link come back HERE?
//
// GATED: needs a running LOCAL Supabase stack (and its mail catcher). Nothing to
// set by hand — playwright.config.ts asks the CLI where the stack and Mailpit
// are, pins the app under test to them, and this spec skips itself otherwise.
//
//   pnpm exec supabase start && pnpm exec supabase db reset
//   pnpm test:e2e
//
// WHY THIS SPEC EXISTS
//
// mvp-lab is ONE Supabase project shared by the whole demo fleet, so its Site
// URL belongs to no app in particular. requestPasswordRecovery() therefore
// passes an explicit redirectTo built from the REQUEST origin. Nothing in the
// unit suite can prove that end of it: the adapter tests mock the Supabase
// client, so they verify the argument was passed, not that Supabase honoured it.
//
// And when Supabase does NOT honour it — because the URL is missing from the
// redirect allow-list — it does not raise an error. It silently substitutes the
// project's Site URL, mails that, and returns success. So the failure mode this
// guards is invisible from the app side by construction; the only witness is the
// captured email. That is the whole reason the bug shipped in the first place.
//
// It also covers the landing route: the recovery redirect used to point at
// /auth/set-password, which does not exist (the page lives in the (auth) route
// GROUP, which contributes no path segment), so every successful code exchange
// ended on a 404. A correct redirect_to with a dead landing page is still a
// broken flow, so both halves are asserted here.
import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

// The URL the APP UNDER TEST is wired to — what playwright.config.ts put in the
// web server's environment — not a parallel variable the app never reads.
const APP_SUPABASE_URL = process.env["E2E_SUPABASE_URL"] ?? "";
const MAILPIT_URL = process.env["E2E_MAILPIT_URL"] ?? "";

const LIVE_LOCAL_STACK =
  /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(APP_SUPABASE_URL) &&
  MAILPIT_URL !== "";

const PASSWORD = "Sup3rSecret!2026";
const DB_CONTAINER = "supabase_db_ez-finance";

function sql(statement: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-t",
      "-A",
      "-c",
      statement,
    ],
    { encoding: "utf8" },
  ).trim();
}

/** Every account this file registers, so afterAll can erase it. */
const registered: string[] = [];

function registerEmail(prefix: string): string {
  const email = `${prefix}.${Date.now()}@test.local`;
  registered.push(email);
  return email;
}

function deleteFixtureAccounts(emails: string[]): void {
  if (emails.length === 0) return;

  const list = emails.map((email) => `'${email}'`).join(", ");
  const ids = `select id from auth.users where email in (${list})`;

  sql(
    `delete from ez_finance.workspaces w
     where exists (
       select 1 from ez_finance.workspace_members m
       where  m.workspace_id = w.id
       and    m.user_id in (${ids})
     );
     delete from ez_finance_private.deletion_requests where user_id in (${ids});
     delete from ez_finance.profiles where id in (${ids});
     delete from auth.users where email in (${list});`,
  );
}

interface CapturedMail {
  readonly text: string;
}

async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

/** The one message Mailpit holds, waited for rather than assumed. */
async function waitForMail(): Promise<CapturedMail> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = (await (
      await fetch(`${MAILPIT_URL}/api/v1/messages`)
    ).json()) as { messages?: { ID: string }[] };

    const id = list.messages?.[0]?.ID;
    if (id !== undefined) {
      const full = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)
      ).json()) as { Text?: string; HTML?: string };
      return { text: `${full.Text ?? ""}${full.HTML ?? ""}` };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`no mail reached Mailpit at ${MAILPIT_URL}`);
}

/**
 * Supabase never links straight at the app. The mailed URL always hits its own
 * /auth/v1/verify, carrying our redirect as the `redirect_to` query parameter,
 * and only 302s onward once the token is consumed. So `redirect_to` — not the
 * link's own origin — is the thing under test.
 */
function recoveryLinkFrom(mail: CapturedMail): URL {
  const link = (mail.text.match(/https?:\/\/[^\s"'<>]+/g) ?? []).find(
    (candidate) => candidate.includes("token") || candidate.includes("code="),
  );

  expect(link, "the recovery mail carried no verification link").toBeDefined();
  return new URL((link as string).replace(/&amp;/g, "&"));
}

test.describe("Password recovery (needs a live LOCAL Supabase stack)", () => {
  test.skip(
    !LIVE_LOCAL_STACK,
    "no local Supabase stack with a mail catcher — run `supabase start` first",
  );

  test.afterAll(() => {
    deleteFixtureAccounts(registered.splice(0));
  });

  test("the emailed link returns to this deployment and reaches the form", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const email = registerEmail("recovery");

    await page.goto("/register");
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    await page.click('button[type="submit"]');

    // Settle the registration navigation BEFORE touching cookies or navigating
    // again. Without this the pending redirect to /check-email lands on top of
    // the next goto and the recovery form is never reached — a race that shows
    // up as an unrelated locator timeout.
    await page.waitForURL(/\/check-email(\?|$)/);

    // Proof, not assumption, that the browser is driving the LOCAL stack —
    // recovery mail for an account that does not exist is never sent, so a
    // misdirected app would fail later with a confusing "no mail" timeout.
    await expect
      .poll(
        () => Number(sql(`select count(*) from auth.users where email = '${email}'`)),
        { message: `"${email}" never reached the local container`, timeout: 15_000 },
      )
      .toBe(1);

    // Registration may leave a session, and an authenticated visitor has no
    // business on /forgot-password. Start the recovery as a stranger would.
    await context.clearCookies();
    await clearMailbox();

    await page.goto("/forgot-password");
    // Fail with the URL we actually reached rather than a bare locator timeout:
    // an authenticated visitor gets bounced off the auth pages by middleware.
    await expect(
      page,
      "did not reach /forgot-password — still holding a session?",
    ).toHaveURL(/\/forgot-password(\?|$)/);

    await page.fill("#recovery-email", email);
    await page.click('button[type="submit"]');

    const link = recoveryLinkFrom(await waitForMail());
    const redirectTo = link.searchParams.get("redirect_to");

    // THE REGRESSION GUARD. A redirect_to equal to the project's Site URL is the
    // signature of a URL missing from the redirect allow-list: Supabase drops
    // ours, substitutes its own default and reports success either way.
    expect(
      redirectTo,
      "redirect_to is not this deployment — if it looks like the Supabase " +
        "project's Site URL, the app's origin is missing from the redirect " +
        "allow-list (locally: additional_redirect_urls in supabase/config.toml, " +
        "and note that a running stack keeps the OLD value until it is fully " +
        "restarted with `supabase stop && supabase start`)",
    ).toBe(`${baseURL}/auth/reset-password`);

    // Following it must land on the real form. Compare the pathname EXACTLY: a
    // loose /set-password match also accepts the dead /auth/set-password this
    // spec exists to catch.
    await page.goto(link.toString());
    await expect
      .poll(() => new URL(page.url()).pathname, {
        message:
          "the recovery link did not land on /set-password — note the page " +
          "lives in the (auth) route GROUP, which adds no path segment, so " +
          "/auth/set-password is a 404",
        timeout: 15_000,
      })
      .toBe("/set-password");

    await expect(page.locator("#reset-password-new")).toBeVisible();
  });
});
