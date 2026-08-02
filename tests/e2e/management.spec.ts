// The management pages, walked in a browser: categories, accounts, budget.
//
// GATED on a live LOCAL stack, like the other data-touching specs.
//
// WHY THESE NEED AN E2E AT ALL. Every one of them exists because a use case had
// exactly one caller and no door — so what is being tested is not the use cases
// (unit tests cover those) but that the doors are REACHABLE from the dashboard, that
// what they write lands in the database, and that the dashboard changes because of
// it. A page that renders and saves nothing looks identical to one that works.
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
    // GOALS FIRST. goals.account_id is ON DELETE RESTRICT, so an account cannot go
    // while a goal still points at it. That restriction is deliberate — deleting an
    // account a goal measures should fail loudly rather than silently take the goal —
    // which makes unwinding in the right order the teardown's job, not the schema's.
    `delete from ez_finance.goals           where workspace_id in (${workspaces});
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

/** The workspace's id, for scoping assertions to this fixture only. */
function workspaceIdOf(email: string): string {
  return sql(
    `select w.id
     from   ez_finance.workspaces        w
     join   ez_finance.workspace_members m on m.workspace_id = w.id
     join   auth.users                   u on u.id = m.user_id
     where  u.email = '${email}' and w.type = 'personal' and w.deleted_at is null`,
  );
}

/**
 * Arrive configured. These pages are about editing an existing setup, not about
 * creating one — tests/e2e/onboarding.spec.ts owns the wizard.
 *
 * ORDER MATTERS, the same way it does in account-lifecycle.spec: the Personal
 * workspace does not exist until bootstrap() runs in the (app) layout, i.e. not until
 * this first sign-in. Seeding before that silently inserts nothing.
 */
async function signInConfigured(page: Page, email: string): Promise<void> {
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

  const workspace = `(select '${workspaceIdOf(email)}'::uuid)`;

  sql(
    `insert into ez_finance.accounts (workspace_id, name, type, currency, initial_balance)
     select ${workspace}, 'Efectivo', 'cash', 'PEN', 0;

     insert into ez_finance.budget_configs
       (workspace_id, effective_from, income_mode, expected_income, pct_need, pct_want, pct_save)
     select ${workspace}, date_trunc('month', current_date)::date, 'mayor', 500000, 50, 30, 20
     on conflict (workspace_id, effective_from) do nothing;`,
  );

  await page.goto("/app");
  await page.waitForURL(/\/app$/);
}

test.describe("Management pages (needs a live LOCAL Supabase stack)", () => {
  test.skip(
    !LIVE_LOCAL_STACK,
    "no local Supabase stack — run `supabase start`",
  );

  test.afterAll(() => {
    deleteFixtureAccounts(registered.splice(0));
  });

  test("categories, accounts and the budget can all be changed after setup", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const email = registerEmail("management");

    await page.goto("/register");
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/check-email/);

    await signInConfigured(page, email);
    const workspaceId = workspaceIdOf(email);

    // === CATEGORIES ========================================================
    // Reachable from the dashboard. Before these pages existed the only route to
    // any of this was a wizard that cannot be re-entered.
    await page.getByRole("link", { name: /categorías/i }).click();
    await page.waitForURL(/\/app\/categorias/);

    // The eleven seeded ones, grouped under the SAME names the dashboard uses.
    for (const heading of [/^necesidades$/i, /^deseos$/i, /^ahorro$/i]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    // --- create one --------------------------------------------------------
    await page.getByText(/agregar una categoría/i).click();
    await page.fill("#category-name", "Mascotas");
    await page.selectOption("#category-bucket", "need");
    await page.getByRole("button", { name: /^agregar$/i }).click();

    await expect(page.getByText(/agregamos «mascotas»/i)).toBeVisible();

    const createdBucket = sql(
      `select bucket from ez_finance.categories
       where workspace_id = '${workspaceId}' and name = 'Mascotas'`,
    );
    expect(createdBucket, "stored in the bucket that was chosen").toBe("need");

    // --- rename one --------------------------------------------------------
    // The safest edit in the app: the row keeps its bucket and its transactions, so
    // every past month reports exactly what it did before under a different label.
    // That is why it is asserted by reading the ROW BACK — the id must not change.
    const beforeRename = sql(
      `select id from ez_finance.categories
       where workspace_id = '${workspaceId}' and name = 'Supermercado'`,
    );

    await page
      .getByRole("button", { name: /renombrar categoría supermercado/i })
      .click();
    await page.getByLabel(/nuevo nombre para supermercado/i).fill("Mercado");
    await page.getByRole("button", { name: /^guardar$/i }).click();

    // EXACT, because "Mercado" is a substring of "Supermercado": a loose match finds
    // the row that has not been renamed yet, passes instantly, and the DB read below
    // then races the server action. The wait has to be for something only the NEW name
    // can satisfy.
    await expect(page.getByText("Mercado", { exact: true })).toBeVisible();

    const afterRename = sql(
      `select id from ez_finance.categories
       where workspace_id = '${workspaceId}' and name = 'Mercado'`,
    );
    expect(afterRename, "the same row, renamed — not a new one").toBe(
      beforeRename,
    );

    // --- archive one -------------------------------------------------------
    await page.getByRole("button", { name: /archivar ocio/i }).click();

    // The confirmation says what archiving does NOT do, because the fear on
    // pressing it is that past months will change.
    await expect(page.getByText(/archivamos «ocio»/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^archivadas$/i }),
    ).toBeVisible();

    const archived = sql(
      `select count(*) from ez_finance.categories
       where workspace_id = '${workspaceId}'
         and name = 'Ocio' and archived_at is not null`,
    );
    expect(Number(archived), "archived, not deleted").toBe(1);

    const stillThere = sql(
      `select count(*) from ez_finance.categories
       where workspace_id = '${workspaceId}' and name = 'Ocio'`,
    );
    expect(Number(stillThere), "the row survives, so history does").toBe(1);

    // An archived category is no longer offered for NEW movements. This is the
    // assertion that proves archiving means something beyond a label.
    await page.goto("/app/movimientos/nuevo");
    await expect(page.locator("#tx-category")).toContainText("Mascotas");
    await expect(page.locator("#tx-category")).not.toContainText("Ocio");

    // --- and back again ----------------------------------------------------
    // Archivar sits next to every row, so pressing it by accident is easy. Until
    // unarchiveMany existed there was nothing to press afterwards: the button was a
    // one-way door on a screen whose whole point is changing your mind.
    await page.goto("/app/categorias");
    await page.getByRole("button", { name: /restaurar ocio/i }).click();
    await expect(
      page.getByText(/«ocio» vuelve a estar disponible/i),
    ).toBeVisible();

    const restored = sql(
      `select count(*) from ez_finance.categories
       where workspace_id = '${workspaceId}'
         and name = 'Ocio' and archived_at is null`,
    );
    expect(Number(restored), "archived_at cleared, not a new row").toBe(1);

    // Offered again — the round trip is complete, not just recorded.
    await page.goto("/app/movimientos/nuevo");
    await expect(page.locator("#tx-category")).toContainText("Ocio");

    // === ACCOUNTS ==========================================================
    await page.goto("/app");
    await page.getByRole("link", { name: /cuentas/i }).click();
    await page.waitForURL(/\/app\/cuentas/);

    // Scoped to the LIST. Plain getByText("Efectivo") also matches the account-type
    // dropdown's <option value="cash">Efectivo</option> further down the page — the
    // seeded account and one of the type choices happen to share a word.
    await expect(
      page.getByRole("listitem").filter({ hasText: "Efectivo" }),
    ).toBeVisible();

    await page.getByText(/agregar una cuenta/i).click();
    await page.fill("#account-name", "Yape");
    await page.selectOption("#account-type", "wallet");
    await page.fill("#account-balance", "250.75");
    await page.getByRole("button", { name: /continuar/i }).click();

    // WAIT FOR AN OBSERVABLE EFFECT before reading the database. click() returns as
    // soon as the click is dispatched, so querying straight afterwards races the
    // server action — it passed by luck until this page grew a second client
    // component and got slower to settle. The row appearing in the list is the
    // effect, and asserting it is worth doing anyway.
    await expect(
      page.getByRole("listitem").filter({ hasText: "Yape" }),
    ).toBeVisible();

    const stored = sql(
      `select type || '|' || currency || '|' || initial_balance
       from   ez_finance.accounts
       where  workspace_id = '${workspaceId}' and name = 'Yape'`,
    );
    // The currency is NOT asked for — the workspace's base currency is immutable —
    // so this asserts it was supplied correctly rather than left blank.
    expect(stored).toBe("wallet|PEN|25075");

    // And the dashboard sees it, because a second account that only exists on its
    // own page would be useless for recording against.
    await page.goto("/app");
    await expect(page.getByText("Yape")).toBeVisible();
    await expect(page.getByText(/S\/\s*250\.75/).first()).toBeVisible();

    // --- rename it, and prove the balance travelled with the name ----------
    await page.goto("/app/cuentas");
    await page.getByRole("button", { name: /renombrar cuenta yape/i }).click();
    await page.getByLabel(/nuevo nombre para yape/i).fill("Yape personal");
    await page.getByRole("button", { name: /^guardar$/i }).click();

    await expect(
      page.getByRole("listitem").filter({ hasText: "Yape personal" }),
    ).toBeVisible();

    // Same row: the balance is still 250.75 and the type is untouched. Renaming must
    // not be a create-and-delete, or the transactions would have nowhere to point.
    const afterAccountRename = sql(
      `select type || '|' || initial_balance
       from   ez_finance.accounts
       where  workspace_id = '${workspaceId}' and name = 'Yape personal'`,
    );
    expect(afterAccountRename).toBe("wallet|25075");

    // Put the name back, so the assertions further down still read "Yape".
    await page
      .getByRole("button", { name: /renombrar cuenta yape personal/i })
      .click();
    await page.getByLabel(/nuevo nombre para yape personal/i).fill("Yape");
    await page.getByRole("button", { name: /^guardar$/i }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Yape" }),
    ).toBeVisible();

    // --- archive it, and prove the money did NOT move ----------------------
    await page.goto("/app/cuentas");
    await page.getByRole("button", { name: /archivar yape/i }).click();
    await expect(
      page.getByRole("button", { name: /restaurar yape/i }),
      "the row flips to offering a way back, which is durable state rather than a" +
        " confirmation message that a later render can supersede",
    ).toBeVisible();

    // THE BALANCE IS STILL ON SCREEN. A figure that vanished on archive would read
    // as the app having lost the money, which is the worst thing a finance app can
    // imply — so the row is marked, not hidden.
    await expect(page.getByText(/S\/\s*250\.75/).first()).toBeVisible();
    await expect(page.getByText(/archivada/i).first()).toBeVisible();

    // Gone from the movement form, which is what archiving is FOR.
    await page.goto("/app/movimientos/nuevo");
    await expect(page.locator("#tx-account")).not.toContainText("Yape");
    await expect(page.locator("#tx-account")).toContainText("Efectivo");

    // --- restore it --------------------------------------------------------
    await page.goto("/app/cuentas");
    await page.getByRole("button", { name: /restaurar yape/i }).click();
    await expect(
      page.getByText(/«yape» vuelve a estar disponible/i),
    ).toBeVisible();

    await page.goto("/app/movimientos/nuevo");
    await expect(page.locator("#tx-account")).toContainText("Yape");

    // --- the last active account cannot be archived ------------------------
    // Not a database rule; the schema permits it. But a workspace with every account
    // archived has nowhere to record anything, and the screen that would explain the
    // dead end is the one you can no longer act from. Refusing the step is kinder.
    await page.goto("/app/cuentas");
    await page.getByRole("button", { name: /archivar yape/i }).click();
    await expect(
      page.getByRole("button", { name: /restaurar yape/i }),
      "the row flips to offering a way back, which is durable state rather than a" +
        " confirmation message that a later render can supersede",
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /archivar efectivo/i }),
      "the only remaining active account offers no way to archive itself",
    ).toBeDisabled();

    // Put it back, so the rest of the walk has two accounts as before.
    await page.getByRole("button", { name: /restaurar yape/i }).click();
    await expect(
      page.getByText(/«yape» vuelve a estar disponible/i),
    ).toBeVisible();

    // === GOALS =============================================================
    // The property that matters: PROGRESS IS DERIVED. There is no saved_amount column,
    // so a goal can only be right if it is reading the account behind it.
    await page.goto("/app");
    await page.getByRole("link", { name: /metas/i }).click();
    await page.waitForURL(/\/app\/metas/);

    // No savings account yet, so the page says what is missing instead of offering an
    // empty picker. Efectivo is cash and Yape is a wallet — neither qualifies.
    await expect(page.getByText(/necesitas una cuenta de tipo/i)).toBeVisible();

    // Create one, with a known opening balance.
    await page.goto("/app/cuentas");
    await page.getByText(/agregar una cuenta/i).click();
    await page.fill("#account-name", "Fondo viaje");
    await page.selectOption("#account-type", "savings");
    await page.fill("#account-balance", "400");
    await page.getByRole("button", { name: /continuar/i }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Fondo viaje" }),
    ).toBeVisible();

    await page.goto("/app/metas");
    await page.getByText(/crear una meta/i).click();
    await page.fill("#goal-name", "Viaje");
    await page.fill("#goal-target", "1000");
    await page.selectOption("#goal-account", { label: "Fondo viaje" });
    await page.getByRole("button", { name: /^crear$/i }).click();

    await expect(page.getByText(/creamos «viaje»/i)).toBeVisible();

    // 400 of 1000 = 40 %, read from the ACCOUNT — nothing wrote a progress figure.
    await expect(page.getByText(/S\/\s*400\.00/).first()).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: /progreso de viaje/i }),
    ).toHaveAttribute("aria-valuenow", "40");

    // Recording income into that account MOVES the goal, with nothing else written.
    await page.goto("/app/movimientos/nuevo");
    await page.locator('label[for="kind-income"]').click();
    await page.fill("#tx-amount", "600");
    await page.selectOption("#tx-account", { label: "Fondo viaje" });
    await page.getByRole("button", { name: /registrar/i }).click();
    await page.waitForURL(/\/app$/);

    await page.goto("/app/metas");
    await expect(
      page.getByRole("progressbar", { name: /progreso de viaje/i }),
    ).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByText(/llegaste/i)).toBeVisible();

    // Archiving the goal must NOT touch the money — the fear the confirmation answers.
    const balanceBefore = sql(
      `select balance from ez_finance.account_balances('${workspaceId}') b
       join ez_finance.accounts a on a.id = b.account_id
       where a.name = 'Fondo viaje'`,
    );

    await page.getByRole("button", { name: /archivar meta viaje/i }).click();
    await expect(page.getByText(/el dinero sigue en su cuenta/i)).toBeVisible();

    const balanceAfter = sql(
      `select balance from ez_finance.account_balances('${workspaceId}') b
       join ez_finance.accounts a on a.id = b.account_id
       where a.name = 'Fondo viaje'`,
    );
    expect(balanceAfter, "archiving a goal moves no money").toBe(balanceBefore);

    // === WORKSPACES ========================================================
    // A second space is the point of Fase 3's first half: money that should not be
    // averaged together, kept apart. What has to hold is ISOLATION.
    await page.goto("/app");
    await page.getByRole("link", { name: /espacios/i }).click();
    await page.waitForURL(/\/app\/espacios/);

    await expect(page.getByText(/estás aquí/i)).toBeVisible();

    await page.getByText(/crear un espacio/i).click();
    await page.fill("#workspace-name", "Negocio");
    await page.getByRole("button", { name: /^crear$/i }).click();
    await expect(page.getByText(/creamos «negocio»/i)).toBeVisible();

    // Created as SHARED, never a second personal one. bootstrap() resolves the home
    // workspace with `type = 'personal' ... limit 1`, so two would make that lookup
    // arbitrary on every request — the invariant the SQL suite also pins.
    const created = sql(
      `select w.type from ez_finance.workspaces w
       join   ez_finance.workspace_members m on m.workspace_id = w.id
       join   auth.users u on u.id = m.user_id
       where  u.email = '${email}' and w.name = 'Negocio'`,
    );
    expect(
      created,
      "a created space is shared, not a second personal one",
    ).toBe("shared");

    // Creating switches you into it, and THE NEW SPACE IS EMPTY — not broken.
    // Before this branch existed, an unconfigured space sent the dashboard to
    // /onboarding, which bounced straight back because the PERSONAL workspace is
    // complete. An infinite redirect loop, introduced by multi-workspace itself.
    await page.goto("/app");
    await expect(
      page.getByText(/este espacio todavía está vacío/i),
    ).toBeVisible();

    // ISOLATION, the whole point: none of the personal space's data is here.
    await expect(page.getByText("Yape")).toHaveCount(0);

    // It did get its own starter categories, so it can bucket from day one — and
    // NOT the one created in the other space.
    await page.goto("/app/categorias");
    await expect(
      page.getByRole("heading", { name: /^necesidades$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /^mascotas$/i }),
      "a category from the personal space must not appear here",
    ).toHaveCount(0);

    // Switch back, and the personal space is exactly as it was left.
    await page.goto("/app/espacios");
    await page.getByRole("button", { name: /cambiar a personal/i }).click();

    // Wait for the switch to LAND before navigating — the same race that bit the
    // account creation earlier in this file. The row for the current space shows
    // "Estás aquí" instead of a button, so the button disappearing is the effect.
    await expect(
      page.getByRole("button", { name: /cambiar a personal/i }),
    ).toHaveCount(0);

    await page.goto("/app");
    await expect(page.getByText("Yape")).toBeVisible();

    // === BUDGET ============================================================
    // Back to the dashboard first: the accounts section ended on /app/cuentas, and
    // the management links live on the dashboard.
    await page.goto("/app");
    await page.getByRole("link", { name: /presupuesto/i }).click();
    await page.waitForURL(/\/app\/presupuesto/);

    // Pre-filled from what is stored — an edit, not a re-entry.
    await expect(page.locator("#expected-income")).toHaveValue("5000");
    await expect(page.locator("#split-need")).toHaveValue("50");

    await page.fill("#expected-income", "4000");
    await page.fill("#split-need", "70");
    await page.fill("#split-want", "20");
    await page.fill("#split-save", "10");
    await expect(page.getByText(/suman 100 %/i)).toBeVisible();

    // The preview computes before saving: 70 % of 4000 is 2800.
    await expect(page.getByText(/S\/\s*2[.,]800\.00/).first()).toBeVisible();

    await page.getByRole("button", { name: /^guardar$/i }).click();
    await expect(page.getByText(/guardado/i)).toBeVisible();

    const savedConfig = sql(
      `select expected_income || '|' || income_mode || '|'
              || pct_need || '/' || pct_want || '/' || pct_save
       from   ez_finance.budget_configs
       where  workspace_id = '${workspaceId}'`,
    );
    expect(savedConfig).toBe("400000|mayor|70/20/10");

    // THE POINT OF THE WHOLE PAGE: the dashboard recomputes from the edit.
    await page.goto("/app");
    await expect(page.getByText("70%")).toBeVisible();
    await expect(page.getByText(/S\/\s*2[.,]800\.00/).first()).toBeVisible();

    // --- and the income mode is reachable again ----------------------------
    // This is the coverage that was lost when the mode question left the wizard:
    // "real" counts only money already received, and no income has been recorded,
    // so every target must fall to zero. It proves the radio still travels all the
    // way into computeBudget.
    await page.goto("/app/presupuesto");
    await page.check("#income-mode-real");
    await page.getByRole("button", { name: /^guardar$/i }).click();
    await expect(page.getByText(/guardado/i)).toBeVisible();

    await page.goto("/app");
    await expect(page.getByText(/S\/\s*0\.00/).first()).toBeVisible();

    const bars = page.getByRole("progressbar");
    await expect(bars).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await expect(bars.nth(index)).toHaveAttribute("aria-valuenow", "0");
    }

    // The stored expected income is untouched — the zeroes are the mode's doing,
    // not lost data.
    const afterMode = sql(
      `select expected_income || '|' || income_mode
       from   ez_finance.budget_configs
       where  workspace_id = '${workspaceId}'`,
    );
    expect(afterMode).toBe("400000|real");
  });
});
