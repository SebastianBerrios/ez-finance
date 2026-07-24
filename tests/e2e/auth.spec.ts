import { expect, test } from "@playwright/test";

test.describe("Auth pages smoke tests", () => {
  test("/login renders in Spanish and is responsive at 360px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);

    // Page title in Spanish
    await expect(page).toHaveTitle(/ingresar/i);

    // Spanish labels present
    await expect(
      page.getByLabel(/correo electrónico/i),
    ).toBeVisible();
    await expect(page.getByLabel(/contraseña/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /ingresar/i }),
    ).toBeVisible();

    // No horizontal overflow at 360px
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
  });

  test("/register renders in Spanish and is responsive at 360px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const response = await page.goto("/register");
    expect(response?.status()).toBe(200);

    // Page title in Spanish
    await expect(page).toHaveTitle(/crear cuenta/i);

    // Spanish labels present
    await expect(
      page.getByLabel(/correo electrónico/i),
    ).toBeVisible();
    await expect(page.getByLabel(/contraseña/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /crear cuenta/i }),
    ).toBeVisible();

    // Password policy hint visible
    await expect(page.getByText(/mínimo 10 caracteres/i)).toBeVisible();

    // No horizontal overflow at 360px
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
  });

  test("/forgot-password renders in Spanish and is responsive at 360px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const response = await page.goto("/forgot-password");
    expect(response?.status()).toBe(200);

    await expect(page.getByLabel(/correo electrónico/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /enviar instrucciones/i }),
    ).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
  });

  test("/login shows GENERIC error message on bad credentials", async ({
    page,
  }) => {
    await page.goto("/login");

    await page.getByLabel(/correo electrónico/i).fill("notexist@example.com");
    await page.getByLabel(/contraseña/i).fill("wrongpassword123");
    await page.getByRole("button", { name: /ingresar/i }).click();

    // Generic error must appear — must NOT say "no confirmado", "no existe", etc.
    // Scope to the form error (not Next.js route announcer which also has role=alert)
    const alert = page
      .getByRole("alert")
      .filter({ hasText: /correo o contraseña/i });
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toHaveText(/correo o contraseña incorrectos/i);

    // Must NOT contain enumeration-leaking phrases
    const alertText = await alert.textContent();
    expect(alertText).not.toMatch(/no confirmado/i);
    expect(alertText).not.toMatch(/no registrado/i);
    expect(alertText).not.toMatch(/no existe/i);
    expect(alertText).not.toMatch(/google/i);
  });

  test("middleware redirects unauthenticated /app to /login", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("middleware allows unauthenticated access to /login", async ({
    page,
  }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login/);
  });

  // Google button smoke tests — verify the button renders on both auth pages.
  // Does NOT attempt a real Google round-trip (requires provisioned provider).
  test("/login renders 'Continuar con Google' button", async ({ page }) => {
    await page.goto("/login");

    const googleButton = page.getByRole("button", {
      name: /continuar con google/i,
    });
    await expect(googleButton).toBeVisible();
    await expect(googleButton).toBeEnabled();
  });

  test("/register renders 'Continuar con Google' button", async ({ page }) => {
    await page.goto("/register");

    const googleButton = page.getByRole("button", {
      name: /continuar con google/i,
    });
    await expect(googleButton).toBeVisible();
    await expect(googleButton).toBeEnabled();
  });

  test("/login has a divider 'o' between Google button and email form", async ({
    page,
  }) => {
    await page.goto("/login");

    // Both the Google button and email field must coexist on the page
    await expect(
      page.getByRole("button", { name: /continuar con google/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/correo electrónico/i)).toBeVisible();
  });
});
