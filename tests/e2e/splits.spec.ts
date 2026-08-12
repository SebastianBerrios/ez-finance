// Splitting an expense, walked in a browser: divide, see who owes, mark one collected.
//
// GATED on a live LOCAL stack, like the other data-touching specs.
//
// WHY THIS NEEDS AN E2E. The unit tests cover the rules and supabase/tests/split_rpcs.sql
// covers the three writes; what neither can see is the WIRING. One split expense travels
// through a form with two parallel repeated fields, a server action that zips them back
// together by position, an RPC that derives the totals, and a list that reads them back
// through embedded selects. Every one of those can be individually correct while the
// person ends up recording a debt for the wrong person, or none at all.
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
    // SPLITS FIRST, and for the same reason management.spec deletes goals first:
    // expense_splits.transaction_id is ON DELETE RESTRICT, so a movement cannot go while
    // a split still explains it. The schema refusing loudly is deliberate; unwinding in
    // the right order is the teardown's job.
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

/**
 * Arrive configured, with a SECOND account on purpose.
 *
 * The repayment lands in an account the person picks, and picking one that is not the
 * one that paid is the whole point of that control — with a single account the select
 * would have one option and the test would prove nothing about it.
 *
 * ORDER MATTERS: the Personal workspace does not exist until bootstrap() runs in the
 * (app) layout, i.e. not until this first sign-in. Seeding before that inserts nothing.
 */
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

     insert into ez_finance.accounts (workspace_id, name, type, currency, initial_balance)
     select ${workspace}, 'Banco', 'bank', 'PEN', 0;

     insert into ez_finance.budget_configs
       (workspace_id, effective_from, income_mode, expected_income, pct_need, pct_want, pct_save)
     select ${workspace}, date_trunc('month', current_date)::date, 'mayor', 500000, 50, 30, 20
     on conflict (workspace_id, effective_from) do nothing;`,
  );

  await page.goto("/app");
  await page.waitForURL(/\/app$/);

  return workspaceId;
}

test.describe("Expense splits (needs a live LOCAL Supabase stack)", () => {
  test.skip(
    !LIVE_LOCAL_STACK,
    "no local Supabase stack — run `supabase start`",
  );

  test.afterAll(() => {
    deleteFixtureAccounts(registered.splice(0));
  });

  test("a shared expense records who owes, and collecting closes it", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const email = registerEmail("splits");

    await page.goto("/register");
    await page.fill("#register-email", email);
    await page.fill("#register-password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/check-email/);

    const workspaceId = await signInConfigured(page, email);

    // ---------------------------------------------------------------------
    // 1. The door is reachable from the dashboard, and starts empty.
    // ---------------------------------------------------------------------
    await page.getByRole("link", { name: /te deben/i }).click();
    await page.waitForURL(/\/app\/deudas$/);
    await expect(page.getByText(/nadie te debe nada/i)).toBeVisible();

    // ---------------------------------------------------------------------
    // 2. Split 90 three ways: 30 mine, 30 Ana, 30 Beto.
    //
    //    TWO debtors on purpose. The form posts the names and the amounts as two
    //    parallel repeated fields, and the action pairs them by position — with one
    //    row a swap or an off-by-one would be invisible.
    // ---------------------------------------------------------------------
    await page.getByRole("link", { name: /dividir un gasto/i }).click();
    await page.waitForURL(/\/app\/movimientos\/dividir$/);

    // BY ID, not by label, and deliberately: "Tu parte" is a substring of "Categoría de
    // tu parte", so a label match resolves to two controls and Playwright refuses it.
    await page.fill("#split-my-share", "30.00");
    await page.selectOption("#split-account", { label: "Efectivo" });
    // Index 1 is the first real category — index 0 is "Sin categoría".
    await page.selectOption("#split-category", { index: 1 });

    await page.fill("#debtor-name-0", "Ana");
    await page.fill("#debtor-amount-0", "30.00");

    // The second row's ids come from a counter that only grows, so the row added here is
    // always -1 no matter what was removed before it.
    await page.getByRole("button", { name: /agregar otra persona/i }).click();
    await page.fill("#debtor-name-1", "Beto");
    await page.fill("#debtor-amount-1", "30.00");

    await page.fill("#split-note", "Asado del sábado");
    await page
      .getByRole("button", { name: /registrar gasto dividido/i })
      .click();

    await page.waitForURL(/\/app\/deudas$/);
    await expect(page.getByText("Ana")).toBeVisible();
    await expect(page.getByText("Beto")).toBeVisible();

    // ---------------------------------------------------------------------
    // 3. What actually landed. The three writes have to agree, and the amounts are
    //    checked in the DATABASE: a total shown on screen can be right while the rows
    //    behind it are not.
    // ---------------------------------------------------------------------
    expect(
      sql(
        `select coalesce(sum(amount), 0) from ez_finance.expense_splits
         where workspace_id = '${workspaceId}' and settled_at is null`,
      ),
    ).toBe("6000");

    // My share only — 30, not the 90 that left the account.
    expect(
      sql(
        `select coalesce(sum(base_amount), 0) from ez_finance.transactions
         where workspace_id = '${workspaceId}' and kind = 'expense'`,
      ),
    ).toBe("3000");

    // 1000.00 initial - 90.00 paid = 910.00 left, in minor units. The money really left
    // the account: the full 90, not just the 30 that was mine.
    expect(
      sql(
        `select balance from ez_finance.account_balances('${workspaceId}')
         where account_id = (select id from ez_finance.accounts
                             where workspace_id = '${workspaceId}' and name = 'Efectivo')`,
      ),
    ).toBe("91000");

    // And the receivable account was created on demand, holding exactly what is owed.
    expect(
      sql(
        `select balance from ez_finance.account_balances('${workspaceId}')
         where account_id = (select id from ez_finance.accounts
                             where workspace_id = '${workspaceId}' and type = 'receivable')`,
      ),
    ).toBe("6000");

    // ---------------------------------------------------------------------
    // 4. Ana pays back, into the BANK account — not the one that paid.
    // ---------------------------------------------------------------------
    const anaRow = page.locator("li", { hasText: "Ana" }).first();
    await anaRow.getByLabel(/entra en/i).selectOption({ label: "Banco" });
    await page.getByRole("button", { name: /marcar cobrado a ana/i }).click();

    await expect(page.getByText(/lo marcamos como cobrado/i)).toBeVisible();

    // Ana moved to the settled section; Beto is still on the hook.
    await expect(
      page.getByRole("heading", { name: /ya cobrado/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /marcar cobrado a beto/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /marcar cobrado a ana/i }),
    ).toHaveCount(0);

    expect(
      sql(
        `select count(*) from ez_finance.expense_splits
         where workspace_id = '${workspaceId}' and settled_at is not null`,
      ),
    ).toBe("1");

    // The 30 landed in the bank account, and the receivable dropped to what is left.
    expect(
      sql(
        `select balance from ez_finance.account_balances('${workspaceId}')
         where account_id = (select id from ez_finance.accounts
                             where workspace_id = '${workspaceId}' and name = 'Banco')`,
      ),
    ).toBe("3000");

    expect(
      sql(
        `select balance from ez_finance.account_balances('${workspaceId}')
         where account_id = (select id from ez_finance.accounts
                             where workspace_id = '${workspaceId}' and type = 'receivable')`,
      ),
    ).toBe("3000");
  });
});
