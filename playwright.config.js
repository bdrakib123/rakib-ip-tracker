"use strict";

const { defineConfig } = require("@playwright/test");
const browserName = process.env.PLAYWRIGHT_BROWSER === "chromium" ? "chromium" : "firefox";

module.exports = defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    browserName,
    headless: true,
    launchOptions: browserName === "chromium" ? { chromiumSandbox: true } : undefined,
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node test/browser/server.js",
    url: "http://127.0.0.1:4173/healthz",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
