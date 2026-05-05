import { test, expect } from "@playwright/test";

// Stable signal that we're on the login view: the username input.
// The auth page's only heading is the brand name (h1 appName), so a
// `heading: /sign in/i` matcher matches nothing — installment 6 of the
// auth redesign replaced the "Sign In" heading with the brand mark +
// a tab-toggle button. The form submit button + the username
// placeholder are the load-bearing logged-out signals.
const USERNAME_FIELD = /username/i;

test.describe("Authentication", () => {
  test("shows login page when not authenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder(USERNAME_FIELD)).toBeVisible();
    // Form submit button is also distinctive (the tab-toggle is a
    // <button> not inside <form>; we scope to form to disambiguate).
    await expect(page.locator("form").getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder(USERNAME_FIELD).fill("wronguser");
    await page.getByPlaceholder(/password/i).fill("wrongpass");
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();

    // Should show error toast/inline message
    await expect(page.getByText(/invalid|failed|incorrect/i)).toBeVisible({ timeout: 5000 });
  });

  test("logs in with valid credentials and reaches dashboard", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder(USERNAME_FIELD).fill("testadmin");
    await page.getByPlaceholder(/password/i).fill("TestPass123!");
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();

    // Sidebar is the canonical "we're inside the app" testid.
    await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 10000 });
  });

  test("logs out and returns to login", async ({ page }) => {
    // Login first
    await page.goto("/");
    await page.getByPlaceholder(USERNAME_FIELD).fill("testadmin");
    await page.getByPlaceholder(/password/i).fill("TestPass123!");
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 10000 });

    // Logout — back to login = username field reappears.
    await page.getByTestId("logout-button").click();
    await expect(page.getByPlaceholder(USERNAME_FIELD)).toBeVisible({ timeout: 5000 });
  });
});
