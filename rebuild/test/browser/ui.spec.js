"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const viewports = [
  { width: 360, height: 800, label: "360x800" },
  { width: 390, height: 844, label: "390x844" },
  { width: 412, height: 915, label: "412x915" },
  { width: 1366, height: 768, label: "1366x768" },
  { width: 1440, height: 900, label: "1440x900" }
];
const shots = path.join(__dirname, "..", "..", "artifacts", "phase-d2");
const adminPassword = "browser-only-admin-password-2026";
fs.mkdirSync(shots, { recursive: true });

async function routeSafeGeoIP(page) {
  await page.route("**/api/public/intelligence", route => route.continue({
    headers: { ...route.request().headers(), "x-forwarded-for": "8.8.8.8" }
  }));
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  expect(dimensions.document, `${label} document overflow`).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body, `${label} body overflow`).toBeLessThanOrEqual(dimensions.viewport);
}

test("public and admin dashboards render and work at mobile and desktop viewports", async ({ browser }) => {
  const issues = [];
  const emptyContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto("/admin");
  await expect(emptyPage.locator("#login-view")).toBeVisible();
  expect(await emptyPage.evaluate(async () => (await fetch("/api/admin/history")).status)).toBe(401);
  await emptyPage.locator("#admin-password").fill(adminPassword);
  await emptyPage.locator("#login-form button[type=submit]").click();
  await expect(emptyPage.locator("#admin-view")).toBeVisible();
  await expect(emptyPage.locator("#history-state")).toContainText("No visitor records found.");
  await expect(emptyPage.locator("#chart-devices")).toContainText("No device data recorded.");
  expect(await emptyPage.locator("#metric-database").textContent()).toContain("Degraded");
  await emptyPage.screenshot({ path: path.join(shots, "admin-empty-360x800.png"), fullPage: true });
  await emptyPage.locator("#logout-button").click();
  await emptyContext.close();

  for (const [index, viewport] of viewports.entries()) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    page.on("console", message => { if (message.type() === "error") issues.push(`${viewport.label} console: ${message.text()}`); });
    page.on("pageerror", error => issues.push(`${viewport.label} page: ${error.message}`));
    let intentionalPublicFailure = false;
    page.on("requestfailed", request => {
      const pathname = new URL(request.url()).pathname;
      if ((intentionalPublicFailure && pathname === "/api/public/intelligence") || pathname === "/api/admin/live") return;
      issues.push(`${viewport.label} request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
    });

    // The actual public form POST runs through Express; a controlled forwarded
    // test IP lets the real provider resolve safe address 8.8.8.8.
    let profilePostCount = 0;
    page.on("request", request => {
      if (request.url().includes("/api/public/intelligence") && request.method() === "POST") profilePostCount += 1;
    });
    await routeSafeGeoIP(page);
    const responsePromise = page.waitForResponse(response => response.url().includes("/api/public/intelligence") && response.request().method() === "POST");
    await page.goto("/");
    const profileResponse = await responsePromise;
    expect(profileResponse.status()).toBe(201);
    await page.waitForTimeout(100);
    expect(profilePostCount, `${viewport.label} profile posts on initial load`).toBe(1);
    await expect(page.locator("#profile-content")).toBeVisible();
    await expect(page.locator("#public-ip")).toHaveText("8.8.8.8");
    await expect(page.locator("#location-name")).not.toHaveText("Unavailable");
    await expect(page.locator('[data-geo="city"]')).not.toHaveText("Lookup failed");
    await expect(page.locator("#device-category")).not.toHaveText("Category unavailable");
    await expect(page.locator("#signals-grid [data-client=viewport]")).toHaveText(`${viewport.width} × ${viewport.height}`);

    const menu = page.locator("#nav-toggle");
    if (viewport.width <= 620) {
      await expect(menu).toBeVisible();
      const privacyTextWidth = await page.locator(".privacy-banner > div:nth-child(2)").evaluate(node => node.getBoundingClientRect().width);
      expect(privacyTextWidth, `${viewport.label} privacy text width`).toBeGreaterThan(150);
      const menuBox = await menu.boundingBox();
      expect(menuBox.width, `${viewport.label} menu target width`).toBeGreaterThanOrEqual(24);
      expect(menuBox.height, `${viewport.label} menu target height`).toBeGreaterThanOrEqual(24);
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await page.locator("#main-navigation a[href='#profile']").click();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
    } else {
      await expect(menu).toBeHidden();
      await expect(page.locator("#main-navigation a[href='#profile']")).toBeVisible();
    }
    await assertNoHorizontalOverflow(page, `public ${viewport.label}`);
    await page.screenshot({ path: path.join(shots, `public-${viewport.label}.png`), fullPage: true });

    // Exercise the profile API's visible error path with an intentional abort.
    intentionalPublicFailure = true;
    await page.unroute("**/api/public/intelligence");
    await page.route("**/api/public/intelligence", route => route.abort("failed"));
    await page.locator("#refresh-profile").click();
    await expect(page.locator("#profile-message")).toContainText("profile service could not be reached");
    intentionalPublicFailure = false;
    await page.unroute("**/api/public/intelligence");

    // Exercise actual admin login, analytics, chart, history, detail modal and
    // filtering against the same in-memory record created by the public page.
    expect(await page.evaluate(async () => (await fetch("/api/admin/history")).status)).toBe(401);
    await page.goto("/admin");
    await expect(page.locator("#login-view")).toBeVisible();
    await page.screenshot({ path: path.join(shots, `admin-login-${viewport.label}.png`), fullPage: true });
    await page.locator("#admin-password").fill(adminPassword);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#metric-total")).not.toHaveText("—");
    await expect(page.locator("#history-state")).toContainText("records");
    await expect(page.locator("#history-list .history-item")).toHaveCount(index + 1);
    await expect(page.locator("#chart-devices .bar-row")).toHaveCount(1);
    await expect(page.locator("#provider-state")).toContainText("online");
    await expect(page.locator("#metric-database")).toContainText("Degraded");

    const historySearch = page.locator("#history-search");
    await historySearch.fill("no-matching-test-record");
    await expect(page.locator("#history-state")).toContainText("No visitor records found.");
    await historySearch.fill("8.8.8.8");
    await expect(page.locator("#history-list .history-item")).toHaveCount(index + 1);
    await page.locator("#history-list [data-detail]").first().click();
    await expect(page.locator("#visitor-dialog")).toBeVisible();
    await expect(page.locator("#dialog-content")).toContainText("Full IP");
    await expect(page.locator("#dialog-content")).toContainText("8.8.8.8");
    await page.locator("#dialog-close").click();
    await expect(page.locator("#visitor-dialog")).not.toBeVisible();
    await assertNoHorizontalOverflow(page, `admin ${viewport.label}`);
    await page.screenshot({ path: path.join(shots, `admin-${viewport.label}.png`), fullPage: true });

    // Verify admin API error feedback while keeping the auth route working.
    await page.route("**/api/admin/analytics/overview", route => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { message: "Synthetic browser test error" } })
    }));
    await page.locator("#refresh-admin").click();
    await expect(page.locator("#admin-message")).toContainText("Dashboard refresh failed");

    // Remove the test-only analytics error before the next viewport.
    await page.unroute("**/api/admin/analytics/overview");
    await page.locator("#logout-button").click();
    await context.close();
  }
  expect(issues, "browser console and network errors").toEqual([]);
});
