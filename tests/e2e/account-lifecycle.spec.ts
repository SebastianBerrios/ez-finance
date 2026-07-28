// Account lifecycle end-to-end (Fase 2c tramo B).
//
// GATED: needs a running LOCAL Supabase stack. There is nothing to set by hand
// — playwright.config.ts asks the CLI where the local stack is, pins the app
// under test to it, and this spec skips itself when there is no such stack.
//
//   pnpm exec supabase start && pnpm exec supabase db reset
//   pnpm test:e2e
//
// DO NOT run it against a server you started yourself. `pnpm dev` / `pnpm start`
// read .env.local, and what that points at is a convention that has drifted to
// the SHARED hosted mvp-lab project before — while this spec registers users,
// erases them and writes deletion-request rows. playwright.config.ts sets
// reuseExistingServer:false precisely so it can vouch for the credentials the
// browser is driving.
//
// This is the only test that exercises the adapter <-> real RPC seam: the unit
// tests mock the Supabase client, so a wrong RPC name, a renamed jsonb key or a
// missing profile row is invisible to them. It caught both at least once.
import { execFileSync } from "node:child_process";

import { unzipSync, strFromU8 } from "fflate";
import { expect, test } from "@playwright/test";

// The URL the APP UNDER TEST is wired to — the one playwright.config.ts put in
// the web server's environment — not some parallel variable the app never
// reads. mvp-lab's auth.users pool is shared with the other apps in the fleet,
// so a signup here must never be able to land there.
const APP_SUPABASE_URL = process.env["E2E_SUPABASE_URL"] ?? "";
const LIVE_LOCAL_STACK = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(
  APP_SUPABASE_URL,
);

const PASSWORD = "Sup3rSecret!2026";

// The terminal state can only be reached by making a grace window expire, and
// waiting 30 days is not a test strategy. These helpers reach into the SAME
// local container the psql behaviour suite uses (supabase/tests/README.md).
// They are the reason this spec refuses to run against anything but a local
// stack — see the LIVE_LOCAL_STACK guard above.
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

/**
 * Every account this file registers, so afterAll can erase it.
 *
 * Both tests used to leave an auth.users row, a personal workspace and a
 * deletion-request ledger entry behind on every run.
 */
const registered: string[] = [];

function registerEmail(prefix: string): string {
  const email = `${prefix}.${Date.now()}@test.local`;
  registered.push(email);
  return email;
}

/**
 * Proof — not assumption — that the browser is driving the LOCAL stack.
 *
 * Runs immediately after the first registration and before anything else is
 * created. If the app were wired anywhere else the row would be missing and
 * the run stops here instead of building a whole account somewhere it must not.
 */
function assertRegisteredLocally(email: string): void {
  const found = sql(
    `select count(*) from auth.users where email = '${email}'`,
  );
  expect(
    Number(found),
    `"${email}" is not in the local container: the app under test is NOT wired to ${APP_SUPABASE_URL}`,
  ).toBe(1);
}

/** Make the pending deletion request of `email` due right now. */
function expireGraceWindow(email: string): void {
  sql(
    `update ez_finance_private.deletion_requests
     set    ends_at = now() - interval '1 second'
     where  user_id = (select id from auth.users where email = '${email}')
     and    cancelled_at is null and finalized_at is null`,
  );
}

/**
 * Run the batch worker the way the cron route handler does — with NO end-user
 * session. This is the whole point of the scenario: the user's own sweep can
 * then only ever return false.
 */
function runScheduledWorker(): number {
  return Number(
    sql("select ez_finance.process_due_deletions() ->> 'finalized'"),
  );
}

/**
 * Erase everything this file created.
 *
 * auth.users cascades to profiles and nulls out workspace_members.user_id, so
 * the personal workspaces have to go first or they survive as orphans — the
 * exact litter the deletion feature exists to avoid.
 */
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

function profileCount(email: string): number {
  return Number(
    sql(
      `select count(*) from ez_finance.profiles
       where id = (select id from auth.users where email = '${email}')`,
    ),
  );
}

test.describe("Account lifecycle (needs a live LOCAL Supabase stack)", () => {
  test.skip(
    !LIVE_LOCAL_STACK,
    `the app under test is wired to "${APP_SUPABASE_URL}", which is not a local stack — run \`pnpm exec supabase start\``,
  );
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    // Leaving these behind pollutes every later run of the psql suites, which
    // assert on counts in the same container.
    deleteFixtureAccounts(registered.splice(0));
  });

  test("export, request deletion, log back in, cancel", async ({ page }) => {
    test.setTimeout(120_000);

    const email = registerEmail("lifecycle");

    // --- register ----------------------------------------------------------
    await page.goto("/register");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByLabel(/^contraseña/i).first().fill(PASSWORD);
    const confirmField = page.getByLabel(/confirm/i);
    if (await confirmField.count()) await confirmField.first().fill(PASSWORD);
    await page.getByRole("button", { name: /crear cuenta/i }).click();
    // The app routes to /check-email by design; the session already exists.
    await page.waitForURL(/\/app|\/check-email/);

    // The signup landed in the LOCAL container, so everything below is safe.
    assertRegisteredLocally(email);

    // --- deep link straight into settings, never having visited /app --------
    // The (app) layout must bootstrap the profile here, otherwise every read on
    // this page fails with a generic "unavailable".
    await page.goto("/app/settings/account");
    await expect(page).toHaveURL(/\/app\/settings\/account/);
    await expect(page.getByText(/no pudimos leer el estado/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /eliminar mi cuenta/i }),
    ).toBeVisible();

    // --- export is a real, readable ZIP of the user's own data --------------
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /descargar mis datos/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^ez-finance-datos-\d{4}-\d{2}-\d{2}\.zip$/,
    );

    const zipPath = await download.path();
    const { readFile } = await import("node:fs/promises");
    const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
    expect(Object.keys(entries).sort()).toEqual([
      "LEEME.txt",
      "espacios.csv",
      "espacios.json",
      "membresias.csv",
      "membresias.json",
      "perfil.csv",
      "perfil.json",
    ]);

    const workspaces = JSON.parse(strFromU8(entries["espacios.json"] as Uint8Array));
    expect(workspaces).toContainEqual(
      expect.objectContaining({ type: "personal" }),
    );

    // --- requesting deletion signs THIS browser out -------------------------
    // Scope is "local", not "global": mvp-lab shares auth.users with the other
    // fleet apps, so a global sign-out would be cross-app damage.
    await page.getByLabel(/escribí/i).fill("ELIMINAR");
    await page.getByRole("button", { name: /eliminar mi cuenta/i }).click();
    await page.waitForURL(/\/login\?deletion=requested/);
    await expect(page.getByRole("status")).toContainText(/30 días/i);

    await page.goto("/app/settings/account");
    await expect(page).toHaveURL(/\/login/);

    // --- the account is reachable again during the grace window -------------
    await page.goto("/login");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByLabel(/contraseña/i).first().fill(PASSWORD);
    await page.getByRole("button", { name: /^ingresar/i }).click();
    await page.waitForURL(/\/app/);

    await page.goto("/app/settings/account");
    // Match the banner text, NOT getByRole("alert"): Next.js renders its route
    // announcer with role="alert" too, so the role selector is intermittently
    // ambiguous depending on client-navigation timing.
    await expect(
      page.getByText(/Tu cuenta está programada para eliminarse/i),
    ).toBeVisible();
    await expect(page.getByText(/Vamos a borrar tus datos el/i)).toBeVisible();

    // --- cancelling restores the account ------------------------------------
    await page
      .getByRole("button", { name: /cancelar la eliminación/i })
      .click();

    // NOTE: do not assert on the absence of "programada para eliminarse" — the
    // delete form's own copy contains that phrase. The cancel button going away
    // is the unambiguous signal.
    await expect(
      page.getByRole("button", { name: /cancelar la eliminación/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /eliminar mi cuenta/i }),
    ).toBeVisible();
  });

  test("an expired account reaches the terminal notice instead of being rebuilt", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const email = registerEmail("terminal");

    // --- register + bootstrap ----------------------------------------------
    await page.goto("/register");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByLabel(/^contraseña/i).first().fill(PASSWORD);
    const confirmField = page.getByLabel(/confirm/i);
    if (await confirmField.count()) await confirmField.first().fill(PASSWORD);
    await page.getByRole("button", { name: /crear cuenta/i }).click();
    await page.waitForURL(/\/app|\/check-email/);

    assertRegisteredLocally(email);

    await page.goto("/app/settings/account");
    await expect(
      page.getByRole("button", { name: /eliminar mi cuenta/i }),
    ).toBeVisible();
    expect(profileCount(email)).toBe(1);

    // --- request deletion, then never come back (the dominant path) ---------
    await page.getByLabel(/escribí/i).fill("ELIMINAR");
    await page.getByRole("button", { name: /eliminar mi cuenta/i }).click();
    await page.waitForURL(/\/login\?deletion=requested/);

    // --- the window expires and the SCHEDULED WORKER finalizes it -----------
    // Out of band, with no session. From here the user's own
    // process_deletion_if_due() can only ever return false, which is exactly
    // what used to make the DELETED branch unreachable and re-provision a
    // fresh empty account on the next sign-in.
    expireGraceWindow(email);
    expect(runScheduledWorker()).toBeGreaterThanOrEqual(1);
    expect(profileCount(email)).toBe(0);

    // --- signing back in must land on the terminal notice -------------------
    await page.goto("/login");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByLabel(/contraseña/i).first().fill(PASSWORD);
    await page.getByRole("button", { name: /^ingresar/i }).click();

    await page.waitForURL(/\/auth\/deleted/);
    await expect(
      page.getByText(/Eliminamos tus datos de ez finance/i),
    ).toBeVisible();

    // The account was NOT silently rebuilt on the way through.
    expect(profileCount(email)).toBe(0);

    // MERELY LOADING THE PAGE CHANGES NOTHING. The notice used to be a GET
    // route handler that acknowledged the erasure and signed the caller out, so
    // any cross-site <img src> consumed it without ever showing it. Reloading
    // must still find the terminal state.
    await page.reload();
    await expect(page).toHaveURL(/\/auth\/deleted/);
    await expect(
      page.getByText(/Eliminamos tus datos de ez finance/i),
    ).toBeVisible();

    // --- only a DELIBERATE confirmation closes the session ------------------
    await page
      .getByRole("button", { name: /entendido, cerrar sesión/i })
      .click();

    await page.waitForURL(/\/login\?deletion=completed/);
    await expect(page.getByRole("status")).toContainText(/eliminamos tus datos/i);

    expect(profileCount(email)).toBe(0);

    // The session is really closed: /app bounces back to login.
    await page.goto("/app/settings/account");
    await expect(page).toHaveURL(/\/login/);

    // --- only a DELIBERATE second sign-in starts a fresh account ------------
    // The notice was acknowledged, so the terminal state is over.
    await page.goto("/login");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByLabel(/contraseña/i).first().fill(PASSWORD);
    await page.getByRole("button", { name: /^ingresar/i }).click();
    await page.waitForURL(/\/app/);

    expect(profileCount(email)).toBe(1);
  });
});
