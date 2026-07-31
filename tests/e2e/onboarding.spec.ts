// The onboarding wizard, walked end to end in a browser.
//
// GATED on a live LOCAL stack, like the other data-touching specs.
//
// This is the only test that proves the wizard is REACHABLE and TERMINATES. Every
// step redirects — the (app) layout sends an unconfigured workspace here, each step
// forwards to the next, and the last one lands on /app — and a wrong condition in
// any of them produces either a loop or a dead end that no unit test can see.
import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

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

  sql(
    `delete from ez_finance.transactions   where workspace_id in (
       select w.id from ez_finance.workspaces w
       join ez_finance.workspace_members m on m.workspace_id = w.id
       where m.user_id in (${ids}));
     delete from ez_finance.budget_configs where workspace_id in (
       select w.id from ez_finance.workspaces w
       join ez_finance.workspace_members m on m.workspace_id = w.id
       where m.user_id in (${ids}));
     delete from ez_finance.accounts       where workspace_id in (
       select w.id from ez_finance.workspaces w
       join ez_finance.workspace_members m on m.workspace_id = w.id
       where m.user_id in (${ids}));
     delete from ez_finance.categories     where workspace_id in (
       select w.id from ez_finance.workspaces w
       join ez_finance.workspace_members m on m.workspace_id = w.id
       where m.user_id in (${ids}));
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

test.describe("Onboarding wizard (needs a live LOCAL Supabase stack)", () => {
  test.skip(
    !LIVE_LOCAL_STACK,
    "no local Supabase stack — run `supabase start`",
  );

  test.afterAll(() => {
    deleteFixtureAccounts(registered.splice(0));
  });

  test("a new account is walked from registration to a usable dashboard", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    const email = registerEmail("onboarding");

    // --- register + confirm (confirmations are ON, so no session yet) ---------
    await page.goto("/register");
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/check-email/);

    sql(
      `update auth.users set email_confirmed_at = now() where email = '${email}'`,
    );

    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page
      .getByLabel(/contraseña/i)
      .first()
      .fill(PASSWORD);
    await page.getByRole("button", { name: /^ingresar/i }).click();

    // --- THE GATE: an unconfigured workspace cannot reach /app ---------------
    await page.waitForURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", {
        name: /vamos a dejar tu presupuesto listo/i,
      }),
    ).toBeVisible();

    // Proof it is a gate and not just a landing page: /app bounces straight back.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/onboarding$/);

    // --- step 2: the account, which fixes the base currency -----------------
    await page.getByRole("link", { name: /empezar/i }).click();
    await page.waitForURL(/\/onboarding\/cuenta/);

    await page.fill("#account-name", "Efectivo");
    await page.selectOption("#account-type", "cash");
    await page.fill("#account-balance", "1500.50");
    await page.getByRole("button", { name: /continuar/i }).click();

    // --- step 3: the seeded categories, minus one ---------------------------
    await page.waitForURL(/\/onboarding\/categorias/);
    await expect(page.getByText(/estas son tus categorías/i)).toBeVisible();

    // Drop exactly one, to prove the choice is honoured rather than decorative.
    const ocio = page.getByRole("checkbox", { name: /^ocio$/i });
    await expect(ocio).toBeChecked();
    await ocio.uncheck();
    await page.getByRole("button", { name: /continuar/i }).click();

    // --- step 4: income + mode ---------------------------------------------
    await page.waitForURL(/\/onboarding\/ingreso/);
    await page.fill("#expected-income", "3500");
    await page.check("#income-mode-real");
    await page.getByRole("button", { name: /continuar/i }).click();

    // --- step 5: the split, with the sum enforced live ----------------------
    await page.waitForURL(/\/onboarding\/reparto/);

    // Prefilled from what step 4 stored, not reset to a default.
    await expect(page.locator("#split-need")).toHaveValue("50");

    // A split that does not sum to 100 cannot be submitted.
    await page.fill("#split-need", "60");
    await expect(page.getByText(/tienen que sumar 100/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /terminar/i }),
    ).toBeDisabled();

    // The person's own split — 50/30/20 is a default, not a rule.
    await page.fill("#split-need", "60");
    await page.fill("#split-want", "25");
    await page.fill("#split-save", "15");
    await expect(page.getByText(/suman 100/i)).toBeVisible();
    await page.getByRole("button", { name: /terminar/i }).click();

    // --- the wizard TERMINATES on the dashboard ----------------------------
    await page.waitForURL(/\/app$/);

    // And the gate now lets them through on a fresh navigation.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);

    // Revisiting the wizard root is turned away, so setup cannot be re-entered.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/app$/);

    // --- everything the wizard claimed to store actually landed ------------
    const stored = sql(
      `select a.name || '|' || a.type || '|' || a.currency || '|' || a.initial_balance
              || '|' || c.income_mode || '|' || c.expected_income
              || '|' || c.pct_need || '/' || c.pct_want || '/' || c.pct_save
       from   ez_finance.accounts a
       join   ez_finance.budget_configs c on c.workspace_id = a.workspace_id
       join   ez_finance.workspace_members m on m.workspace_id = a.workspace_id
       join   auth.users u on u.id = m.user_id
       where  u.email = '${email}'`,
    );

    expect(stored).toBe("Efectivo|cash|PEN|150050|real|350000|60/25/15");

    const archivedOcio = sql(
      `select count(*) from ez_finance.categories c
       join   ez_finance.workspace_members m on m.workspace_id = c.workspace_id
       join   auth.users u on u.id = m.user_id
       where  u.email = '${email}' and c.name = 'Ocio' and c.archived_at is not null`,
    );
    expect(Number(archivedOcio), "the unchecked category was archived").toBe(1);

    const stillActive = sql(
      `select count(*) from ez_finance.categories c
       join   ez_finance.workspace_members m on m.workspace_id = c.workspace_id
       join   auth.users u on u.id = m.user_id
       where  u.email = '${email}' and c.archived_at is null`,
    );
    expect(Number(stillActive), "the other ten were kept").toBe(10);

    // --- and the dashboard COMPUTES from it --------------------------------
    // The whole point of the wizard: what it stored is what the engine reads.
    // 3500.00 split 60/25/15 with nothing spent yet, in soles.
    await expect(
      page.getByRole("heading", { name: /tu presupuesto/i }),
    ).toBeVisible();

    for (const label of [/necesidades/i, /deseos/i, /ahorro/i]) {
      await expect(page.getByRole("heading", { name: label })).toBeVisible();
    }

    // THE CARDS SHOW *THIS PERSON'S* SPLIT, 60/25/15 — not the 50/30/20 default.
    // Added after re-reading the page and finding the shares hardcoded there: the
    // amounts were already correct, so nothing else in this test could have caught
    // labels that quietly contradicted them.
    await expect(page.getByText("60%")).toBeVisible();
    await expect(page.getByText("25%")).toBeVisible();
    await expect(page.getByText("15%")).toBeVisible();
    await expect(page.getByText("50%")).toHaveCount(0);

    // EVERY figure reads zero, and that is the engine obeying the income mode this
    // wizard run chose — not an empty dashboard.
    //
    // Step 4 selected "real", which counts only income ALREADY RECEIVED. No income
    // transaction exists yet, so the effective income is 0 and all three targets
    // are 0 with it. The form says as much next to the option ("a inicio de mes
    // verás todo en 0 %"), and asserting it here is what proves the choice
    // travelled from the radio button through the database into computeBudget. An
    // expectation of S/ 3,500.00 would have been asserting the DEFAULT mode's
    // behaviour while the test had deliberately picked another.
    //
    // Matched by REGEX because Intl separates the symbol from the digits with
    // U+00A0: "S/ 0.00" typed with an ordinary space does not match what renders.
    await expect(page.getByText(/S\/\s*0\.00/).first()).toBeVisible();

    // Zero income yields 0 %, never a blank or a NaN — the engine's documented
    // guard for a month with no money in it.
    const bars = page.getByRole("progressbar");
    await expect(bars).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await expect(bars.nth(index)).toHaveAttribute("aria-valuenow", "0");
    }

    // And the stored expected income IS the 3500 that was typed — the zeroes above
    // are the mode's doing, not lost data.
    const storedIncome = sql(
      `select c.expected_income || '|' || c.income_mode
       from   ez_finance.budget_configs c
       join   ez_finance.workspace_members m on m.workspace_id = c.workspace_id
       join   auth.users u on u.id = m.user_id
       where  u.email = '${email}'`,
    );
    expect(storedIncome).toBe("350000|real");

    // --- recording money MOVES the buckets ---------------------------------
    // Everything above proves setup stored what it claimed. This proves the loop
    // closes: under mode "real" the dashboard only comes alive once income is
    // actually recorded, which is the behaviour the form promised.
    await page.getByRole("link", { name: /registrar movimiento/i }).click();
    await page.waitForURL(/\/app\/movimientos\/nuevo/);

    // An income of 1000 — the denominator the buckets are measured against.
    // The radio itself is sr-only, so it is not a clickable target — the visible
    // control is its label, which is what a person actually presses.
    await page.locator('label[for="kind-income"]').click();
    await page.fill("#tx-amount", "1000");
    await page.getByRole("button", { name: /registrar/i }).click();
    await page.waitForURL(/\/app$/);

    // 60 % of 1000 for needs, 15 % for savings — the person's own split applied to
    // income that now exists.
    await expect(page.getByText(/S\/\s*600\.00/).first()).toBeVisible();
    await expect(page.getByText(/S\/\s*150\.00/).first()).toBeVisible();

    // Now an expense against a NEEDS category, which must consume that bucket.
    await page.getByRole("link", { name: /registrar movimiento/i }).click();
    await page.waitForURL(/\/app\/movimientos\/nuevo/);
    await page.fill("#tx-amount", "150.50");
    // The option text carries the bucket after the name, so the label must match
    // what is rendered rather than just the category name.
    await page.selectOption("#tx-category", {
      label: "Supermercado · Necesidad",
    });
    await page.getByRole("button", { name: /registrar/i }).click();
    await page.waitForURL(/\/app$/);

    // 600.00 - 150.50 left in needs, and the bar has moved off zero.
    await expect(page.getByText(/S\/\s*449\.50/).first()).toBeVisible();

    const needsBar = page.getByRole("progressbar").first();
    await expect(needsBar).not.toHaveAttribute("aria-valuenow", "0");

    // The expense landed as ONE row, positive, with its category — the sign lives
    // in `kind`, never in the number.
    const recorded = sql(
      `select t.kind || '|' || t.base_amount || '|' || t.entered_currency
              || '|' || t.exchange_rate || '|' || coalesce(c.name, 'none')
       from   ez_finance.transactions t
       left join ez_finance.categories c on c.id = t.category_id
       join   ez_finance.workspace_members m on m.workspace_id = t.workspace_id
       join   auth.users u on u.id = m.user_id
       where  u.email = '${email}' and t.kind = 'expense'`,
    );
    expect(recorded).toBe("expense|15050|PEN|1.0000000000|Supermercado");

    // --- the list shows it, and the balance reflects it ---------------------
    await expect(page.getByText(/movimientos del mes/i)).toBeVisible();
    // The expense is labelled by its CATEGORY, which is what a person recognises.
    await expect(page.getByText("Supermercado").first()).toBeVisible();

    // Efectivo: opened at 1500.50, +1000 income, -150.50 expense = 2350.00
    await expect(page.getByText(/S\/\s*2,350\.00/).first()).toBeVisible();

    // --- deleting it puts the money back -----------------------------------
    // The real test of the sign rule and of the delete path together: the figures
    // have to move BACK, not just change.
    await page.getByRole("button", { name: /eliminar supermercado/i }).click();

    // Needs returns to the full 600.00, the expense leaves the list, and the
    // balance goes back to 1500.50 + 1000.
    await expect(page.getByText("Supermercado")).toHaveCount(0);
    await expect(page.getByText(/S\/\s*600\.00/).first()).toBeVisible();
    await expect(page.getByText(/S\/\s*2,500\.50/).first()).toBeVisible();

    const remaining = sql(
      `select count(*) from ez_finance.transactions t
       join   ez_finance.workspace_members m on m.workspace_id = t.workspace_id
       join   auth.users u on u.id = m.user_id
       where  u.email = '${email}' and t.kind = 'expense'`,
    );
    expect(Number(remaining), "the row is gone, not hidden").toBe(0);
  });
});
