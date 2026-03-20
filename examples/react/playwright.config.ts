import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const appPort = Number(process.env.SNAPFEED_APP_PORT ?? 4173);
const apiPort = Number(process.env.SNAPFEED_API_PORT ?? 8420);
const dbPath = path.resolve(
  appRoot,
  process.env.SNAPFEED_E2E_DB_PATH ??
    ".tmp/playwright/snapfeed-react-example.db",
);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:server",
      cwd: appRoot,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        SNAPFEED_API_PORT: String(apiPort),
        SNAPFEED_E2E_DB_PATH: dbPath,
        SNAPFEED_RESET_DB: "true",
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${appPort} --strictPort`,
      cwd: appRoot,
      url: `http://127.0.0.1:${appPort}`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
        VITE_SNAPFEED_ENDPOINT: `http://127.0.0.1:${apiPort}/api/telemetry/events`,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
