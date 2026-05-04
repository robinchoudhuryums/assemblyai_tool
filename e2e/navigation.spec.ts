import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder(/username/i).fill("testadmin");
  await page.getByPlaceholder(/password/i).fill("TestPass123!");
  // Scope to the form — the auth page also has a tab-toggle "Sign In" button.
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 10000 });
}

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar navigation links work", async ({ page }) => {
    // Navigate to Transcripts
    await page.getByTestId("nav-link-nav.transcripts").click();
    await expect(page).toHaveURL(/\/transcripts/);

    // Navigate to Search
    await page.getByTestId("nav-link-nav.search").click();
    await expect(page).toHaveURL(/\/search/);

    // Navigate to Reports
    await page.getByTestId("nav-link-nav.reports").click();
    await expect(page).toHaveURL(/\/reports/);

    // Navigate to Performance
    await page.getByTestId("nav-link-nav.performance").click();
    await expect(page).toHaveURL(/\/performance/);
  });

  test("admin links visible for admin users", async ({ page }) => {
    await expect(page.getByTestId("nav-link-admin")).toBeVisible();
    await expect(page.getByTestId("nav-link-templates")).toBeVisible();
    await expect(page.getByTestId("nav-link-ab-testing")).toBeVisible();
    await expect(page.getByTestId("nav-link-spend")).toBeVisible();
    await expect(page.getByTestId("nav-link-security")).toBeVisible();
  });

  test("keyboard shortcut D navigates to dashboard", async ({ page }) => {
    await page.getByTestId("nav-link-nav.search").click();
    await expect(page).toHaveURL(/\/search/);

    await page.keyboard.press("d");
    await expect(page).toHaveURL(/\/$/);
  });

  test("keyboard shortcut ? opens shortcuts dialog", async ({ page }) => {
    await page.keyboard.press("?");
    await expect(page.getByText("Keyboard Shortcuts")).toBeVisible();
  });
});
