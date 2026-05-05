/**
 * Shared helpers for the e2e suite.
 *
 * Login + post-login dialog dismissal — every spec needs this. Without
 * `dismissMfaSetupPromptIfPresent`, the MFA setup dialog blocks every
 * subsequent click in the test (its `bg-black/50` backdrop intercepts
 * pointer events). The dialog appears for any admin/manager user who
 * isn't enrolled in MFA, regardless of whether REQUIRE_MFA is set —
 * `isMFARoleRequired(user.role)` returns true unconditionally for
 * admin/manager (server/services/totp.ts), and the testadmin user
 * loaded from AUTH_USERS has no DB row to store an MFA secret in.
 *
 * The dialog is dismissable via its X button (aria-label="Close
 * dialog"). Closing once per session is enough — `setShowMfaPrompt` is
 * only called when login fires, not on every navigation.
 */
import { type Page, expect } from "@playwright/test";

export async function dismissMfaSetupPromptIfPresent(page: Page): Promise<void> {
  // Race-free: check whether the dialog is open with a short timeout
  // and click close if visible. If not visible within 1s, assume it's
  // not going to appear and continue.
  const close = page.getByLabel("Close dialog");
  try {
    await close.waitFor({ state: "visible", timeout: 1000 });
    await close.click();
  } catch {
    // Dialog not present — fine, skip.
  }
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/username/i).fill("testadmin");
  await page.getByPlaceholder(/password/i).fill("TestPass123!");
  // Scope to the form — the auth page also has a tab-toggle "Sign In" button.
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 10000 });
  await dismissMfaSetupPromptIfPresent(page);
}
