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
  // The dialog renders asynchronously after the /api/auth/login response
  // resolves on the client. In CI this can take 2–4s for cold tests, so
  // a short fixed timeout races. Strategy:
  //   1. Wait for the network to settle (login round-trip + initial
  //      /api/auth/me query) so the React tree has had a chance to
  //      decide whether to render the dialog.
  //   2. If the dialog is now visible, click close. If not, skip.
  //   3. After clicking close, wait for the backdrop to actually leave
  //      the DOM — otherwise subsequent clicks can still hit it during
  //      the dialog's exit animation.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
    // network may stay busy due to background polling — proceed anyway
  });
  const close = page.getByLabel("Close dialog");
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    // Confirm the backdrop is gone before returning
    await page
      .locator('[role="dialog"]')
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => { /* dialog might already be gone */ });
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

