// Account lifecycle end-to-end (Fase 2c tramo B).
//
// GATED: needs a running Supabase stack, so it is skipped unless
// SUPABASE_TEST_URL is set — same convention as the integration tests.
//
//   pnpm exec supabase start && pnpm exec supabase db reset
//   pnpm dev                       # or the Playwright webServer
//   SUPABASE_TEST_URL=http://127.0.0.1:54331 pnpm test:e2e
//
// This is the only test that exercises the adapter <-> real RPC seam: the unit
// tests mock the Supabase client, so a wrong RPC name, a renamed jsonb key or a
// missing profile row is invisible to them. It caught both at least once.
import { execFileSync } from "node:child_process";

import { unzipSync, strFromU8 } from "fflate";
import { expect, test } from "@playwright/test";

// The guard demands a LOCAL stack on purpose. This test registers users, and
// mvp-lab's auth.users pool is shared with the other apps in the fleet — test
// signups must never land there. `pnpm start` (what the Playwright webServer
// builds) reads .env.local, which points at the hosted project, so an
// unqualified "is the env var set?" check would be enough to pollute it.
const STACK_URL = process.env["SUPABASE_TEST_URL"] ?? "";
const LIVE_LOCAL_STACK = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(STACK_URL);

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
  return Number(sql("select ez_finance.process_due_deletions()"));
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
    "set SUPABASE_TEST_URL to a local stack (http://127.0.0.1:54331) to run",
  );
  test.describe.configure({ mode: "serial" });

  test("export, request deletion, log back in, cancel", async ({ page }) => {
    test.setTimeout(120_000);

    const email = `lifecycle.${Date.now()}@test.local`;

    // --- register ----------------------------------------------------------
    await page.goto("/register");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByLabel(/^contraseña/i).first().fill(PASSWORD);
    const confirmField = page.getByLabel(/confirm/i);
    if (await confirmField.count()) await confirmField.first().fill(PASSWORD);
    await page.getByRole("button", { name: /crear cuenta/i }).click();
    // The app routes to /check-email by design; the session already exists.
    await page.waitForURL(/\/app|\/check-email/);

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

    const email = `terminal.${Date.now()}@test.local`;

    // --- register + bootstrap ----------------------------------------------
    await page.goto("/register");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByLabel(/^contraseña/i).first().fill(PASSWORD);
    const confirmField = page.getByLabel(/confirm/i);
    if (await confirmField.count()) await confirmField.first().fill(PASSWORD);
    await page.getByRole("button", { name: /crear cuenta/i }).click();
    await page.waitForURL(/\/app|\/check-email/);

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

    await page.waitForURL(/\/login\?deletion=completed/);
    await expect(page.getByRole("status")).toContainText(/eliminamos tus datos/i);

    // The account was NOT silently rebuilt on the way through.
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
