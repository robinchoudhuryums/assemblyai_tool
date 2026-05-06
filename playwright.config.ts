import { defineConfig, devices } from "@playwright/test";

const BASE_PORT = parseInt(process.env.PORT || "5000");
const MFA_REQUIRED_PORT = BASE_PORT + 1;

// Shared env for both dev-server instances. Diverges only on PORT and
// REQUIRE_MFA below — keep this in sync with the inline AUTH_USERS in
// .github/workflows/ci.yml when adding/removing test users.
const SHARED_DEV_SERVER_ENV = {
  SESSION_SECRET: "test-secret-for-e2e",
  AUTH_USERS:
    "testadmin:TestPass123!:admin:Test Admin," +
    "testviewer:ViewPass123!:viewer:Test Viewer," +
    "testmfa:MfaTestPass123!:admin:Test MFA",
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
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // GitHub annotations on the PR + a written html report at
  // playwright-report/. The CI workflow uploads playwright-report/ as
  // an artifact (ci.yml `Upload Playwright report` step), so without
  // the html reporter the artifact would be empty — exactly what we
  // saw debugging PR #167's e2e failures. Locally the html reporter
  // also opens automatically; in CI we suppress that.
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "html",
  timeout: 30_000,

  use: {
    // Default baseURL — overridden per-project below for the
    // mfa-required project so its spec hits its own dev server.
    baseURL: `http://localhost:${BASE_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      // Default project — runs against the standard dev server
      // (no REQUIRE_MFA). Excludes the mfa-required spec, which
      // needs a different env.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mfa-required\.spec\.ts$/,
    },
    {
      // Dedicated project for REQUIRE_MFA=true assertions. Targets
      // the second dev server on BASE_PORT+1. Only matches
      // mfa-required.spec.ts so it doesn't double-run any other
      // spec against the alt server.
      name: "mfa-required",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${MFA_REQUIRED_PORT}`,
      },
      testMatch: /mfa-required\.spec\.ts$/,
    },
  ],

  // Two dev servers run in parallel. The Playwright runner waits for
  // both to come up before any spec runs. ~5s extra boot in CI; ~500MB
  // extra memory. Trade-off accepted because REQUIRE_MFA is read at
  // server boot — there is no in-process way to flip it for some
  // requests but not others, so a separate process is the only option.
  webServer: [
    {
      command: "npm run dev",
      port: BASE_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { ...SHARED_DEV_SERVER_ENV, PORT: String(BASE_PORT) },
    },
    {
      command: "npm run dev",
      port: MFA_REQUIRED_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...SHARED_DEV_SERVER_ENV,
        PORT: String(MFA_REQUIRED_PORT),
        REQUIRE_MFA: "true",
      },
    },
  ],
});
