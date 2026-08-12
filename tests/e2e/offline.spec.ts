// Recording a movement with no connection, and having it arrive on reconnect (spec §3.3).
//
// GATED on a live LOCAL stack, like the other data-touching specs.
//
// WHY THIS IS THE ONLY TEST THAT CAN PROVE IT. The unit tests cover the queue's rules and
// the sync route's decisions, but the promise being made here is a SEQUENCE across a
// network state change: the write must not reach the database while offline, must survive
// in the browser, and must land exactly once when the connection returns. Every piece can
// be individually correct while the person's movement quietly never arrives — which is
// the single worst outcome this feature could have.
import { execFileSync } from "node:child_process";

import { type Page, expect, test } from "@playwright/test";

const APP_SUPABASE_URL = process.env["E2E_SUPABASE_URL"] ?? "";
const LIVE_LOCAL_STACK = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(
  APP_SUPABASE_URL,
);

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
  const workspaces = `
    select w.id from ez_finance.workspaces w
    join ez_finance.workspace_members m on m.workspace_id = w.id
    where m.user_id in (${ids})`;

  sql(
    `delete from ez_finance.expense_splits where workspace_id in (${workspaces});
     delete from ez_finance.scheduled_transactions where workspace_id in (${workspaces});
     delete from ez_finance.goals          where workspace_id in (${workspaces});
     delete from ez_finance.transactions   where workspace_id in (${workspaces});
     delete from ez_finance.budget_configs where workspace_id in (${workspaces});
     delete from ez_finance.accounts       where workspace_id in (${workspaces});
     delete from ez_finance.categories     where workspace_id in (${workspaces});
     delete from ez_finance.workspaces w
     where exists (
       select 1 from ez_finance.workspace_members m
       where m.workspace_id = w.id and m.user_id in (${ids})
     );
     delete from ez_finance_private.deletion_requests where user_id in (${ids});
     delete from ez_finance.profiles where id in (${ids});
     delete from auth.users where email in (${list});`,
  );
}

function workspaceIdOf(email: string): string {
  return sql(
    `select w.id
     from   ez_finance.workspaces        w
     join   ez_finance.workspace_members m on m.workspace_id = w.id
     join   auth.users                   u on u.id = m.user_id
     where  u.email = '${email}' and w.type = 'personal' and w.deleted_at is null`,
  );
}

async function signInConfigured(page: Page, email: string): Promise<string> {
  sql(
    `update auth.users set email_confirmed_at = now() where email = '${email}'`,
  );

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel(/correo electrónico/i).fill(email);
  await page
    .getByLabel(/contraseña/i)
    .first()
    .fill(PASSWORD);
  await page.getByRole("button", { name: /^ingresar/i }).click();
  await page.waitForURL(/\/(app|onboarding)/);

  const workspaceId = workspaceIdOf(email);
  const workspace = `(select '${workspaceId}'::uuid)`;

  sql(
    `insert into ez_finance.accounts (workspace_id, name, type, currency, initial_balance)
     select ${workspace}, 'Efectivo', 'cash', 'PEN', 100000;

     insert into ez_finance.budget_configs
       (workspace_id, effective_from, income_mode, expected_income, pct_need, pct_want, pct_save)
     select ${workspace}, date_trunc('month', current_date)::date, 'mayor', 500000, 50, 30, 20
     on conflict (workspace_id, effective_from) do nothing;`,
  );

  await page.goto("/app");
  await page.waitForURL(/\/app$/);

  return workspaceId;
}

function movementCount(workspaceId: string, note: string): number {
  return Number(
    sql(
      `select count(*) from ez_finance.transactions
       where workspace_id = '${workspaceId}' and note = '${note}'`,
    ),
  );
}

test.describe("Offline recording (needs a live LOCAL Supabase stack)", () => {
  test.skip(
    !LIVE_LOCAL_STACK,
    "no local Supabase stack — run `supabase start`",
  );

  test.afterAll(() => {
    deleteFixtureAccounts(registered.splice(0));
  });

  test("a movement recorded offline is kept on the device and lands on reconnect", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    const email = registerEmail("offline");

    await page.goto("/register");
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/check-email/);

    const workspaceId = await signInConfigured(page, email);

    // The form has to be OPEN before the connection drops: this feature is about
    // recording without a connection, not about navigating without one.
    await page.goto("/app/movimientos/nuevo");
    await expect(page.locator("#tx-amount")).toBeVisible();

    // ---------------------------------------------------------------------
    // 1. Offline: the form still saves, and says where.
    // ---------------------------------------------------------------------
    await context.setOffline(true);

    // The banner is the app noticing, and it must appear without a reload.
    await expect(page.getByText(/sin conexión/i)).toBeVisible();

    await page.fill("#tx-amount", "12.34");
    await page.fill("#tx-note", "Cafe sin senal");
    await page.click('button[type="submit"]');

    await expect(page.getByText(/guardado en este dispositivo/i)).toBeVisible();

    // ---------------------------------------------------------------------
    // 2. And NOTHING reached the database. If it had, the whole queue would be
    //    theatre — and worse, the reconnect would then write it a second time.
    // ---------------------------------------------------------------------
    expect(movementCount(workspaceId, "Cafe sin senal")).toBe(0);

    // The form is cleared, so the next movement starts empty rather than re-submitting
    // the last one.
    await expect(page.locator("#tx-amount")).toHaveValue("");

    // ---------------------------------------------------------------------
    // 3. Back online: it arrives, exactly once.
    // ---------------------------------------------------------------------
    await context.setOffline(false);

    // Polled rather than asserted once: the drain starts on the browser's 'online' event
    // and finishes when the request does, which is not a moment this test can name.
    await expect
      .poll(() => movementCount(workspaceId, "Cafe sin senal"), {
        timeout: 30_000,
      })
      .toBe(1);

    // The amount survived the round trip through IndexedDB and the sync route, in minor
    // units. 12.34 → 1234, not 12 and not 1234.0000001.
    expect(
      sql(
        `select base_amount from ez_finance.transactions
         where workspace_id = '${workspaceId}' and note = 'Cafe sin senal'`,
      ),
    ).toBe("1234");

    // EXACTLY ONCE, checked after the queue has had every chance to drain again: a
    // reconnect that re-sent what already landed would double the person's spending.
    await page.goto("/app");
    await expect(page.getByText("Cafe sin senal")).toBeVisible();
    expect(movementCount(workspaceId, "Cafe sin senal")).toBe(1);
  });

  test("the queue survives a reload, so closing the app does not lose a movement", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    const email = registerEmail("offline-reload");

    await page.goto("/register");
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/check-email/);

    const workspaceId = await signInConfigured(page, email);

    await page.goto("/app/movimientos/nuevo");

    /*
      WAIT FOR THE WORKER, then load the page once more.

      This is not test choreography, it is the feature's actual shape: a service worker
      does not control the page that registered it until it activates, so nothing is
      cached during that first load. A person's FIRST visit on a device is therefore never
      offline-capable, and every visit after it is. Asserting the offline reload without
      this would be asserting something service workers do not do.
    */
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    await page.reload();
    await expect(page.locator("#tx-amount")).toBeVisible();

    await context.setOffline(true);
    await page.fill("#tx-amount", "7.00");
    await page.fill("#tx-note", "Pan offline");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/guardado en este dispositivo/i)).toBeVisible();

    /*
      THE RELOAD IS THE POINT. The queue is IndexedDB and not component state precisely
      so that closing the app — or a phone killing the tab to save memory, which is the
      normal case — does not throw the movement away. Reloaded while STILL offline, so
      the page has to come back from the service worker's cache as well.
    */
    await page.reload();

    // Still offline: the banner is back, and it knows the queue is not empty.
    await expect(page.getByText(/sin conexión/i)).toBeVisible();
    await expect(page.getByText(/1 movimiento esperando/i)).toBeVisible();

    await context.setOffline(false);

    await expect
      .poll(() => movementCount(workspaceId, "Pan offline"), {
        timeout: 30_000,
      })
      .toBe(1);
  });
});
