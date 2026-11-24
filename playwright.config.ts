import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * E2E идёт только в демо-режиме: сервер запускается сам, ключи Yandex пустые,
 * поэтому тесты никогда не обращаются к живому поиску и LLM.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DEMO_MODE: "on",
      YANDEX_API_KEY: "",
      YANDEX_FOLDER_ID: "",
      LLM_API_KEY: "",
      LLM_BASE_URL: "",
      LLM_MODEL: "",
    },
  },
});
