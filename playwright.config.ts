import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,

  use: {
    baseURL: `http://localhost:${process.env.PORT || 5000}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start the dev server before running tests
  webServer: {
    command: "npm run dev",
    port: parseInt(process.env.PORT || "5000"),
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      SESSION_SECRET: "test-secret-for-e2e",
      AUTH_USERS: "testadmin:TestPass123!:admin:Test Admin,testviewer:ViewPass123!:viewer:Test Viewer",
    },
  },
});
