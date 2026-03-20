import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("shows login page when not authenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder(/username/i).fill("wronguser");
    await page.getByPlaceholder(/password/i).fill("wrongpass");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should show error
    await expect(page.getByText(/invalid|failed|incorrect/i)).toBeVisible({ timeout: 5000 });
  });

  test("logs in with valid credentials and reaches dashboard", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder(/username/i).fill("testadmin");
    await page.getByPlaceholder(/password/i).fill("TestPass123!");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should navigate to dashboard
    await expect(page.getByText(/CallAnalyzer/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("sidebar")).toBeVisible();
  });

  test("logs out and returns to login", async ({ page }) => {
    // Login first
    await page.goto("/");
    await page.getByPlaceholder(/username/i).fill("testadmin");
    await page.getByPlaceholder(/password/i).fill("TestPass123!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 10000 });

    // Logout
    await page.getByTestId("logout-button").click();
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({ timeout: 5000 });
  });
});
