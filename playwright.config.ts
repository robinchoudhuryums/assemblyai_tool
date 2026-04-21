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
      // Activate MSW-Node interception of AssemblyAI / Bedrock / S3.
      // Without this the dev server would fail on the first outbound
      // fetch during the upload → transcribe → analyze flow.
      E2E_MOCKS: "true",
      // Dummy creds so the providers don't refuse to initialize. The
      // actual fetches are intercepted by MSW.
      ASSEMBLYAI_API_KEY: "e2e-mock-key",
      AWS_ACCESS_KEY_ID: "e2e-mock-aws-key",
      AWS_SECRET_ACCESS_KEY: "e2e-mock-aws-secret",
      AWS_REGION: "us-east-1",
    },
  },
});
