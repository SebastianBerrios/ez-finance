import { expect, test } from "@playwright/test";

test.describe("Home page smoke test", () => {
  test("returns HTTP 200 and shows Spanish heading", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.getByText("ez finance")).toBeVisible();
  });

  test("theme toggle element is present", async ({ page }) => {
    await page.goto("/");

    // The theme toggle button should be present with aria-label
    const themeToggle = page.getByRole("button", {
      name: /toggle/i,
    });
    await expect(themeToggle).toBeVisible();
  });

  /*
    THIS TEST CHANGED MEANING and is worth keeping for the new one.

    It used to say "this app has no service worker at all". Now there is one, and this
    asserts that it is NOT registered from the public pages: it is registered from the
    (app) layout, behind the login. That boundary is deliberate — the worker caches
    rendered pages, and a worker scoped over /login and /auth/* would start keeping copies
    of pages that set cookies and carry one-time tokens.

    So a visitor who never signs in installs nothing.
  */
  test("no service worker is registered on the public pages", async ({
    page,
  }) => {
    await page.goto("/");

    const registrations = await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((regs) => regs.length),
    );
    expect(registrations).toBe(0);
  });
});
