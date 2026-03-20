import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder(/username/i).fill("testadmin");
  await page.getByPlaceholder(/password/i).fill("TestPass123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 10000 });
}

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard loads without errors", async ({ page }) => {
    await page.goto("/");

    // Dashboard should show metrics section (even if empty)
    // Look for the page to render without error boundary triggering
    await expect(page.getByText(/Something went wrong/i)).not.toBeVisible();
  });

  test("dark mode toggle works", async ({ page }) => {
    // Get the current state
    const htmlElement = page.locator("html");

    // Find and click the dark mode toggle button
    const toggleButton = page.getByLabel(/switch to (dark|light) mode/i);
    await toggleButton.click();

    // Check that the class changed
    const hasDark = await htmlElement.evaluate((el) => el.classList.contains("dark"));
    // Toggle back
    await toggleButton.click();
    const hasDarkAfter = await htmlElement.evaluate((el) => el.classList.contains("dark"));

    // One of these should be true and the other false
    expect(hasDark).not.toBe(hasDarkAfter);
  });
});
