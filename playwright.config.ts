import { defineConfig, devices } from "@playwright/test";

// Smoke tests against a running app and a Supabase stack with data: by default the isolated end-to-end
// stack (API 55321, Mailpit 55324) and the app served for it on 5174. See README › Tests.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5174",
    storageState: "e2e/.auth/admin.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
