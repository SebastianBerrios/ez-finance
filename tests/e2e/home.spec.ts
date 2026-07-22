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

  test("no service worker is registered", async ({ page }) => {
    await page.goto("/");

    const registrations = await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((regs) => regs.length)
    );
    expect(registrations).toBe(0);
  });
});
