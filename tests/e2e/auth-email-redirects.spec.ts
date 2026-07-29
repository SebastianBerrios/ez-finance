// Every auth email must come back to the deployment that asked for it.
//
// GATED: needs a running LOCAL Supabase stack (and its mail catcher). Nothing to
// set by hand — playwright.config.ts asks the CLI where the stack and Mailpit
// are, pins the app under test to them, and this spec skips itself otherwise.
//
//   pnpm exec supabase start && pnpm exec supabase db reset
//   pnpm test:e2e
//
// WHY THIS FILE EXISTS
//
// mvp-lab is ONE Supabase project shared by the whole demo fleet, so its Site
// URL belongs to no app in particular. The auth adapter therefore passes an
// explicit redirect, built from the REQUEST origin, on every path that mails a
// link. Nothing in the unit suite can prove that end of it: the adapter tests
// mock the Supabase client, so they verify the argument was PASSED, not that
// Supabase honoured it.
//
// And when Supabase does NOT honour it — because the URL is missing from the
// redirect allow-list — it does not raise an error. It silently substitutes the
// project's Site URL, mails that, and returns success. So the failure mode this
// guards is invisible from the app side by construction; the only witness is the
// captured email. That is the whole reason the bug shipped in the first place.
//
// COVERAGE, AND THE ONE GAP
//
//   requestPasswordRecovery  -> covered below. Mails a link unconditionally.
//   changeEmail              -> covered below. Mails unconditionally too, and
//                               twice while double_confirm_changes is on.
//   register (signUp)        -> NOT COVERED HERE, and not by omission. Supabase
//                               only mails a signup confirmation when
//                               [auth] enable_confirmations is true, and the
//                               local stack has it false. Turning it on would
//                               make every other spec's "register then log in"
//                               fail on an unconfirmed address, so covering it
//                               is a deliberate config decision, not a test
//                               change. Its redirect stays unit-tested only —
//                               see supabase-auth-adapter.test.ts.
import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

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

  // The email-change flow can leave the account under its NEW address, so match
  // the fixture prefix too — otherwise the row survives and pollutes the psql
  // suites that assert on counts in this same container.
  const list = emails.map((email) => `'${email}'`).join(", ");
  const renamed = emails.map((email) => `'next.${email}'`).join(", ");
  const ids = `select id from auth.users where email in (${list}, ${renamed})`;

  sql(
    `delete from ez_finance.workspaces w
     where exists (
       select 1 from ez_finance.workspace_members m
       where  m.workspace_id = w.id
       and    m.user_id in (${ids})
     );
     delete from ez_finance_private.deletion_requests where user_id in (${ids});
     delete from ez_finance.profiles where id in (${ids});
     delete from auth.users where email in (${list}, ${renamed});`,
  );
}

async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

/**
 * Wait until Mailpit holds at least `expected` messages, then return their
 * bodies. Waiting for a COUNT rather than for "any mail" matters for the
 * email-change flow: double_confirm_changes sends two, and grabbing whichever
 * arrived first would assert on the winner of a race.
 */
async function waitForMails(expected: number): Promise<string[]> {
  for (let attempt = 0; attempt < 24; attempt++) {
    const list = (await (
      await fetch(`${MAILPIT_URL}/api/v1/messages`)
    ).json()) as { messages?: { ID: string }[] };

    const ids = (list.messages ?? []).map((message) => message.ID);
    if (ids.length >= expected) {
      return Promise.all(
        ids.map(async (id) => {
          const full = (await (
            await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)
          ).json()) as { Text?: string; HTML?: string };
          return `${full.Text ?? ""}${full.HTML ?? ""}`;
        }),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `expected ${expected} message(s) at Mailpit (${MAILPIT_URL}); timed out`,
  );
}

/**
 * Supabase never links straight at the app. The mailed URL always hits its own
 * /auth/v1/verify, carrying our redirect as the `redirect_to` query parameter,
 * and only 302s onward once the token is consumed. So `redirect_to` — not the
 * link's own origin — is the thing under test.
 */
function verificationLinksIn(bodies: string[], expected: number): URL[] {
  // Deduplicated, because each message carries the same link in its plain-text
  // AND html parts and both are searched — raw matches would double every count.
  const byHref = new Map<string, URL>();

  for (const body of bodies) {
    for (const candidate of body.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
      if (!candidate.includes("token") && !candidate.includes("code=")) continue;
      const href = candidate.replace(/&amp;/g, "&");
      if (!byHref.has(href)) byHref.set(href, new URL(href));
    }
  }

  const links = [...byHref.values()];

  // Counted, not merely non-empty: asserting "at least one" would let a mail
  // that carries NO link pass on the strength of its sibling, which is exactly
  // what the two-confirmation case has to rule out.
  expect(
    links.length,
    `expected ${expected} distinct verification link(s) across ${bodies.length} captured mail(s)`,
  ).toBe(expected);
  return links;
}

/**
 * A redirect_to equal to the project's Site URL is the signature of a URL
 * missing from the redirect allow-list: Supabase drops ours, substitutes its own
 * default and reports success either way. Hence the message.
 */
function expectRedirectsTo(links: URL[], want: string): void {
  for (const link of links) {
    expect(
      link.searchParams.get("redirect_to"),
      "redirect_to is not this deployment — if it looks like the Supabase " +
        "project's Site URL, the app's origin is missing from the redirect " +
        "allow-list (locally: additional_redirect_urls in supabase/config.toml, " +
        "and note that a running stack keeps the OLD value until it is fully " +
        "restarted with `supabase stop && supabase start`)",
    ).toBe(want);
  }
}

/** Register through the UI and prove the row landed in the LOCAL container. */
async function registerLocally(page: Page, email: string): Promise<void> {
  await page.goto("/register");
  await page.fill("#register-email", email);
  await page.fill("#register-password", PASSWORD);
  await page.click('button[type="submit"]');

  // Settle the registration navigation BEFORE touching cookies or navigating
  // again. Without this the pending redirect to /check-email lands on top of
  // the next goto — a race that surfaces as an unrelated locator timeout.
  await page.waitForURL(/\/check-email(\?|$)/);

  // Proof, not assumption, that the browser is driving the LOCAL stack. Mail is
  // never sent for an account that does not exist, so a misdirected app would
  // otherwise fail later with a confusing "no mail" timeout.
  await expect
    .poll(
      () =>
        Number(sql(`select count(*) from auth.users where email = '${email}'`)),
      {
        message: `"${email}" never reached the local container`,
        timeout: 15_000,
      },
    )
    .toBe(1);
}

async function logIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/correo electrónico/i).fill(email);
  await page.getByLabel(/contraseña/i).first().fill(PASSWORD);
  await page.getByRole("button", { name: /^ingresar/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe("Auth email redirects (needs a live LOCAL Supabase stack)", () => {
  test.skip(
    !LIVE_LOCAL_STACK,
    "no local Supabase stack with a mail catcher — run `supabase start` first",
  );

  // The mailbox is shared state and both tests assert on its contents, so they
  // must not interleave. Everything else in the suite still runs in parallel.
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    deleteFixtureAccounts(registered.splice(0));
  });

  test("the recovery link returns to this deployment and reaches the form", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const email = registerEmail("recovery");
    await registerLocally(page, email);

    // Registration may leave a session, and an authenticated visitor has no
    // business on /forgot-password. Start the recovery as a stranger would.
    await context.clearCookies();
    await clearMailbox();

    await page.goto("/forgot-password");
    // Fail with the URL we actually reached rather than a bare locator timeout.
    await expect(
      page,
      "did not reach /forgot-password — still holding a session?",
    ).toHaveURL(/\/forgot-password(\?|$)/);

    await page.fill("#recovery-email", email);
    await page.click('button[type="submit"]');

    const links = verificationLinksIn(await waitForMails(1), 1);
    expectRedirectsTo(links, `${baseURL}/auth/reset-password`);

    // Following it must land on the real form. Compare the pathname EXACTLY: a
    // loose /set-password match also accepts the dead /auth/set-password this
    // spec exists to catch.
    await page.goto(links[0]!.toString());
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

  test("both email-change confirmations return to this deployment", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const email = registerEmail("changemail");
    await registerLocally(page, email);

    // Registering already leaves a session while enable_confirmations is off,
    // and middleware bounces an authenticated visitor off /login. Drop it and
    // sign in deliberately, so the session under test is one this spec created
    // rather than a side effect whose existence depends on that setting.
    await context.clearCookies();
    await logIn(page, email);

    // Clear AFTER logging in, so nothing registration or login produced can be
    // mistaken for a change-confirmation.
    await clearMailbox();

    await page.goto("/app/settings/security/change-email");
    await page.fill("#change-email-new", `next.${email}`);
    await page.click('button[type="submit"]');

    // double_confirm_changes sends one to the OLD address and one to the NEW.
    // BOTH carry the redirect and both have to come back here — a half-fixed
    // flow would strand whoever happened to click the other one.
    const links = verificationLinksIn(await waitForMails(2), 2);
    expectRedirectsTo(links, `${baseURL}/auth/callback`);
  });
});
