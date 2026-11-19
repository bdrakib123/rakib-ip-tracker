"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { createVisitorService } = require("../src/services/visitorService");
const { detectDevice } = require("../src/device/detectDevice");
const { GeoProviderError } = require("../src/geolocation/ipwhoProvider");
const { createAdminAnalytics } = require("../src/services/adminAnalytics");

const key = "0123456789abcdef".repeat(4);
const password = "rebuild-test-password-strong";

function makeRepository() {
  const records = [];
  const adminSessions = new Map();
  let savedAnalytics = { version: 1, collectedFrom: new Date().toISOString(), requests: [], pages: [], security: [], sessions: [] };
  return {
    records,
    async countByIpHash() { return 0; },
    async insert(document) { const saved = { ...document, _id: `fake-${records.length + 1}` }; records.push(saved); return saved; },
    async history({ page = 1, limit = 50 } = {}) {
      return { page: Number(page), limit: Number(limit), total: records.length, pages: 1, data: records };
    },
    async findById(id) { return records.find(record => String(record._id) === id) || null; },
    async clearAll() { const count = records.length; records.splice(0); return count; },
    async clearCreatedSince(cutoff) { const before = records.length; for (let i = records.length - 1; i >= 0; i--) if (new Date(records[i].createdAt) >= cutoff) records.splice(i, 1); return before - records.length; },
    async distinctIpCount() { return new Set(records.map(record => record.ipHash).filter(Boolean)).size; },
    async createAdminSession(tokenHash, expiresAt) { adminSessions.set(tokenHash, expiresAt); },
    async hasAdminSession(tokenHash) { const expiresAt = adminSessions.get(tokenHash); return Boolean(expiresAt && expiresAt > new Date()); },
    async revokeAdminSession(tokenHash) { adminSessions.delete(tokenHash); },
    async consumeRateLimit(_key, _windowMs, max) { return { allowed: true, remaining: max - 1, resetAt: new Date(Date.now() + 60_000) }; },
    async distinctIpCountSince() { return this.distinctIpCount(); },
    async returningVisitorCountSince() { return records.filter(record => record.analytics?.returningVisitor).length; },
    async getAnalytics() { return structuredClone(savedAnalytics); },
    async saveAnalyticsBatch(events) {
      for (const event of events) {
        if (event.type === "request") savedAnalytics.requests.push({ ...event, referrer: null });
        if (event.type === "page") savedAnalytics.pages.push({ ...event, title: null, referrer: null });
        if (event.sessionId) {
          let session = savedAnalytics.sessions.find(item => item.sessionId === event.sessionId);
          if (!session) { session = { sessionId: event.sessionId, createdAt: event.createdAt, firstPath: event.path, lastSeen: event.createdAt, updatedAt: event.createdAt, requestCount: 0 }; savedAnalytics.sessions.push(session); }
          session.lastSeen = event.createdAt; session.updatedAt = event.createdAt;
          if (event.type === "request") session.requestCount += 1;
        }
        const securityType = event.securityType || ({ 401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited" })[event.status];
        if (securityType) savedAnalytics.security.push({ type: securityType, method: event.method, path: event.path, createdAt: event.createdAt, sessionId: null });
      }
    },
    async analyticsSnapshot() {
      const requests = savedAnalytics.requests;
      const pages = savedAnalytics.pages;
      const securityEvents = savedAnalytics.security;
      const sessions = savedAnalytics.sessions;
      const statusCodes = new Map();
      for (const item of requests) statusCodes.set(item.status, (statusCodes.get(item.status) || 0) + 1);
      return { collectedFrom: savedAnalytics.collectedFrom, totalPageViews: pages.length, activeSessions: sessions.length,
        lastHour: { requests: requests.length }, last24h: { requests: requests.length, pageViews: pages.length, sessions: sessions.length, securityEvents: securityEvents.length },
        runtime: { totalRequests: requests.length, errors: 0, averageResponseMs: 0 },
        statusCodes: [...statusCodes].map(([status, count]) => ({ status, count })), endpoints: [],
        requestEvents: requests.slice(-500).reverse(), pageRows: [...new Set(pages.map(item => item.path))].map(path => {
          const rows = pages.filter(item => item.path === path);
          const measured = rows.filter(item => Number.isFinite(item.duration));
          return { path, views: rows.length, averageDuration: measured.length ? Math.round(measured.reduce((sum, item) => sum + item.duration, 0) / measured.length) : null };
        }),
        sessions: sessions.slice().reverse(), securityEvents: securityEvents.slice(-200).reverse(),
        availability: { historical: false, collectedFrom: savedAnalytics.collectedFrom, retentionDays: 30 } };
    },
    async sessionAnalyticsDetail(id) { const session = savedAnalytics.sessions.find(item => item.sessionId === id); return session ? { session, pages: savedAnalytics.pages.filter(item => item.sessionId === id), requests: savedAnalytics.requests.filter(item => item.sessionId === id), visitors: [] } : null; },
    async findVisitorsForSession(id) { return records.filter(item => item.analytics?.sessionId === id); },
    async overview() { return { totalVisitors: records.length, last24h: records.length, countries: [], devices: [], browsers: [], operatingSystems: [], daily: [] }; },
    async ping() { return true; }
  };
}

async function withServer(fn, { rateLimit = 30, trustProxyHops = 0, stagingPassword = null, vercelMode = false } = {}) {
  const repository = makeRepository();
  const visitorService = createVisitorService({
    repository,
    geoService: { lookup: async () => { throw new GeoProviderError("network_error", { retryable: true }); } },
    detectDevice,
    encryptionKey: key,
    logger: { warn() {}, error() {} }
  });
  let activeSSEListeners = 0;
  const originalSubscribe = visitorService.subscribe;
  visitorService.subscribe = listener => {
    activeSSEListeners += 1;
    const unsubscribe = originalSubscribe(listener);
    return () => { activeSSEListeners -= 1; unsubscribe(); };
  };
  const geoService = { health: () => ({ provider: "mock", state: "error", lastCheckedAt: null, lastErrorCode: "network_error" }) };
  const loggedErrors = [];
  const config = { adminPassword: password, nodeEnv: "test", trustProxyHops, publicRateLimit: rateLimit, loginRateLimit: 5,
    ...(vercelMode ? { vercelMode: true } : {}),
    ...(stagingPassword ? { stagingMode: true, stagingAccessPassword: stagingPassword, secureCookies: true } : {}) };
  const analytics = createAdminAnalytics({ repository, geoService, encryptionKey: key, flushDelayMs: 60_000 });
  const app = createApp({ config, repository, visitorService, geoService, analytics, logger: { error(...args) { loggedErrors.push(args); } } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ origin, repository, visitorService, server, app, activeSSEListeners: () => activeSSEListeners, loggedErrors }); }
  finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await analytics.close(); }
}

test("public intelligence keeps IP and device data when geolocation fails", async () => {
  await withServer(async ({ origin, repository }) => {
    const response = await fetch(`${origin}/api/public/intelligence`, {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      body: JSON.stringify({ client: { language: "en-US", timezone: "Etc/UTC", screen: { width: 390, height: 844 } } })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.data.ip, "127.0.0.1");
    assert.equal(payload.data.geo.status, "failed");
    assert.equal(payload.data.browser.name, "Chrome");
    assert.equal(payload.data.os.name, "Windows");
    assert.equal(payload.data.device.category, "desktop");
    assert.equal(repository.records.length, 1);
    assert.equal(repository.records[0].ip, undefined);
    assert.equal(repository.records[0].ipMasked, "127.0.0.xxx");
  });
});

test("untrusted X-Forwarded-For cannot spoof client IP when proxy trust is disabled", async () => {
  await withServer(async ({ origin, repository }) => {
    const response = await fetch(`${origin}/api/public/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.77" },
      body: "{}"
    });
    assert.equal(response.status, 201);
    assert.equal(repository.records[0].ipMasked, "127.0.0.xxx");
    assert.notEqual(repository.records[0].ipMasked, "198.51.100.xxx");
  });
});

test("changing forged forwarding headers cannot create new rate-limit buckets with proxy trust disabled", async () => {
  await withServer(async ({ origin, repository }) => {
    const results = [];
    for (const forwarded of ["198.51.100.17", "203.0.113.19", "198.51.100.17, 203.0.113.19"]) {
      results.push(await fetch(`${origin}/api/public/intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": forwarded },
        body: "{}"
      }));
    }
    assert.deepEqual(results.map(response => response.status), [201, 201, 429]);
    assert.equal(repository.records.length, 2);
  }, { rateLimit: 2, trustProxyHops: 0 });
});

test("one-hop proxy trust uses forwarded input and therefore requires a verified sanitizing proxy", async () => {
  await withServer(async ({ origin, repository }) => {
    const response = await fetch(`${origin}/api/public/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.77" },
      body: "{}"
    });
    assert.equal(response.status, 201);
    assert.equal(repository.records[0].ipMasked, "198.51.100.xxx");
  }, { trustProxyHops: 1 });
});

test("public history masks IP and excludes sensitive geo metadata; admin history requires auth", async () => {
  await withServer(async ({ origin }) => {
    await fetch(`${origin}/api/public/intelligence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const publicResponse = await fetch(`${origin}/api/public/history`);
    const publicPayload = await publicResponse.json();
    const serialized = JSON.stringify(publicPayload);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicPayload.data.data[0].ip, "127.0.0.xxx");
    assert.equal(serialized.includes("127.0.0.1"), false);
    assert.equal(serialized.includes("isp"), false);
    assert.equal(serialized.includes("organization"), false);
    assert.equal(serialized.includes("latitude"), false);
    assert.equal(serialized.includes("longitude"), false);

    const locked = await fetch(`${origin}/api/admin/history`);
    assert.equal(locked.status, 401);
  });
});

test("legacy tracker and history aliases preserve safe V3 response boundaries", async () => {
  await withServer(async ({ origin, repository }) => {
    const tracked = await fetch(`${origin}/api/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(tracked.status, 200);
    const trackPayload = await tracked.json();
    assert.ok(trackPayload.visitor.ip);
    assert.equal(Object.hasOwn(trackPayload, "data"), false);
    const preview = await fetch(`${origin}/api/history-preview`).then(response => response.json());
    assert.equal(preview.locked, true);
    assert.equal(preview.data.length, 1);
    assert.match(preview.data[0].ip, /x/);
    assert.equal(preview.data[0].geo.fields.isp, undefined);
    const history = await fetch(`${origin}/api/history`).then(response => response.json());
    assert.equal(history.locked, false);
    assert.match(history.data[0].ip, /x/);
    const stats = await fetch(`${origin}/api/stats`).then(response => response.json());
    assert.equal(stats.total, 1);
    assert.equal(stats.security.available, false);
    assert.equal((await fetch(`${origin}/api/analytics/requests`)).status, 401);
    const pageview = await fetch(`${origin}/api/analytics/pageview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/home?secret=discard" }) });
    assert.equal(pageview.status, 200);
    assert.equal(repository.records[0].ip, undefined);
    const trackedGet = await fetch(`${origin}/api/track`);
    assert.equal(trackedGet.status, 200);
    const getPayload = await trackedGet.json();
    assert.ok(getPayload.visitor.ip);
    assert.equal(Object.hasOwn(getPayload, "data"), false);
  });
});

test("legacy login aliases share V3 admin sessions and data clearing remains protected", async () => {
  await withServer(async ({ origin, repository }) => {
    await fetch(`${origin}/api/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await fetch(`${origin}/api/analytics/pageview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/home?secret=discard" }) });
    assert.equal((await fetch(`${origin}/api/admin/clear-data`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "history" }) })).status, 401);
    const login = await fetch(`${origin}/api/live/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const telemetry = await fetch(`${origin}/api/analytics/overview`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(telemetry.success, true);
    assert.equal(typeof telemetry.runtime.totalRequests, "number");
    const pages = await fetch(`${origin}/api/analytics/pages`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(pages.data[0].path, "/home");
    assert.equal(pages.historicalDataAvailable, false);
    assert.equal(typeof pages.collectedFrom, "string");
    assert.equal(JSON.stringify(pages).includes("secret"), false);
    const requests = await fetch(`${origin}/api/analytics/requests?limit=25`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(requests.success, true);
    assert.equal(requests.historicalDataAvailable, false);
    assert.equal(typeof requests.collectedFrom, "string");
    assert.equal(JSON.stringify(requests).includes("Synthetic UA"), false);
    const clear = await fetch(`${origin}/api/admin/clear-data`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ type: "history" }) });
    assert.equal(clear.status, 200);
    assert.equal((await clear.json()).data.deleted, 1);
    assert.equal(repository.records.length, 0);
    assert.equal((await fetch(`${origin}/api/live/status`, { headers: { Cookie: cookie } }).then(response => response.json())).authenticated, true);
  });
});

test("legacy admin-history response remains available while the V3 contract is explicitly selected", async () => {
  await withServer(async ({ origin, repository }) => {
    await fetch(`${origin}/api/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const login = await fetch(`${origin}/api/live/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const legacy = await fetch(`${origin}/api/admin/history`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(Array.isArray(legacy.data), true);
    assert.equal(legacy.count, 1);
    assert.equal(legacy.total, 1);
    const v3 = await fetch(`${origin}/api/admin/history?contract=v3`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(Array.isArray(v3.data.data), true);
    assert.equal(v3.data.page, 1);
    assert.equal(repository.records.length, 1);
  });
});

test("session and security analytics restore privacy-reduced legacy contracts behind admin authentication", async () => {
  await withServer(async ({ origin }) => {
    const page = await fetch(`${origin}/`);
    const analyticsCookie = page.headers.get("set-cookie").split(";")[0];
    assert.match(page.headers.get("set-cookie"), /HttpOnly/);
    assert.match(page.headers.get("set-cookie"), /SameSite=Lax/);
    const visitor = await fetch(`${origin}/api/public/intelligence`, {
      method: "POST", headers: { Cookie: analyticsCookie, "Content-Type": "application/json", "User-Agent": "Synthetic UA must not enter telemetry" }, body: "{}"
    });
    assert.equal(visitor.status, 201);
    const pageView = await fetch(`${origin}/api/analytics/pageview`, {
      method: "POST", headers: { Cookie: analyticsCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/dashboard?token=synthetic-secret", duration: 125 })
    });
    assert.equal(pageView.status, 200);
    assert.deepEqual(await pageView.json(), { success: true });
    assert.equal((await fetch(`${origin}/api/admin/history`)).status, 401);
    await fetch(`${origin}/private-route/203.0.113.99`);

    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    assert.equal(login.status, 200);
    const adminCookie = login.headers.get("set-cookie").split(";")[0];
    const cookie = analyticsCookie + "; " + adminCookie;

    const sessionsResponse = await fetch(`${origin}/api/analytics/sessions?limit=5`, { headers: { Cookie: cookie } });
    const sessions = await sessionsResponse.json();
    assert.equal(sessionsResponse.status, 200);
    assert.equal(sessions.success, true);
    assert.equal(sessions.count, 1);
    assert.equal(sessions.historicalDataAvailable, false);
    assert.match(sessions.data[0].sessionId, /^[a-f0-9]{64}$/);
    assert.equal(sessions.data[0].ipHash, null);
    assert.equal(sessions.data[0].userAgent, null);
    const rawBrowserToken = analyticsCookie.split("=")[1];
    assert.equal(JSON.stringify(sessions).includes(rawBrowserToken), false);

    const sessionId = sessions.data[0].sessionId;
    const details = await fetch(`${origin}/api/analytics/session/${sessionId}`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(details.success, true);
    assert.equal(details.historicalDataAvailable, false);
    assert.equal(typeof details.collectedFrom, "string");
    assert.equal(details.session.sessionId, sessionId);
    assert.equal(details.session.firstPath, "/");
    assert.equal(details.pages.some(item => item.path === "/dashboard" && item.duration === 125), true);
    assert.equal(details.visitors.length, 1);

    const pages = await fetch(`${origin}/api/analytics/pages`, { headers: { Cookie: cookie } }).then(response => response.json());
    const dashboardPage = pages.pages.find(item => item.path === "/dashboard");
    assert.equal(dashboardPage.views, 1);
    assert.equal(dashboardPage.averageDuration, 125);
    const requests = await fetch(`${origin}/api/analytics/requests?limit=20`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(requests.success, true);
    assert.equal(requests.data[0].referrer, null);
    assert.equal(JSON.stringify(requests).includes("Synthetic UA"), false);
    assert.equal(JSON.stringify(requests).includes("synthetic-secret"), false);

    const security = await fetch(`${origin}/api/analytics/security`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(security.success, true);
    assert.equal(security.data.some(item => item.type === "unauthorized"), true);
    assert.equal(security.data.some(item => item.path.includes("203.0.113.99")), false);
    assert.equal(JSON.stringify(security).includes("Synthetic UA"), false);

    const overview = await fetch(`${origin}/api/analytics/overview`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(typeof overview.activeSessions, "number");
    assert.equal(typeof overview.last24h.pageViews, "number");
    assert.equal(typeof overview.runtime.totalRequests, "number");
    assert.equal(overview.availability.historical, false);
    assert.ok(overview.availability.collectedFrom);
    assert.equal((await fetch(`${origin}/api/analytics/sessions?limit=0`, { headers: { Cookie: cookie } })).status, 400);
  });
});

test("admin login enables protected API access and logout revokes the server session", async () => {
  await withServer(async ({ origin }) => {
    const denied = await fetch(`${origin}/api/admin/analytics/overview`);
    assert.equal(denied.status, 401);
    assert.equal((await fetch(`${origin}/api/admin/live`)).status, 401);
    for (const route of ["/api/analytics/overview", "/api/analytics/requests", "/api/analytics/pages",
      "/api/analytics/sessions", "/api/analytics/session/" + "a".repeat(64), "/api/analytics/security",
      "/api/admin/history", "/api/admin/export?format=json"]) {
      assert.equal((await fetch(`${origin}${route}`)).status, 401, `${route} must require admin authentication`);
    }
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const status = await fetch(`${origin}/api/admin/auth/status`, { headers: { Cookie: cookie } });
    assert.equal((await status.json()).data.authenticated, true);
    const overview = await fetch(`${origin}/api/admin/analytics/overview`, { headers: { Cookie: cookie } });
    assert.equal(overview.status, 200);
    const logout = await fetch(`${origin}/api/admin/auth/logout`, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(logout.status, 200);
    const after = await fetch(`${origin}/api/admin/history`, { headers: { Cookie: cookie } });
    assert.equal(after.status, 401);
  });
});

test("admin login rejects cross-origin requests and rate limits repeated attempts", async () => {
  await withServer(async ({ origin }) => {
    const badOrigin = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: "https://attacker.invalid", "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    assert.equal(badOrigin.status, 403);
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await fetch(`${origin}/api/admin/auth/login`, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "incorrect" })
      });
    }
    assert.equal(last.status, 429);
  });
});

test("public intelligence rate limit is enforced", async () => {
  await withServer(async ({ origin }) => {
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await fetch(`${origin}/api/public/intelligence`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
      });
    }
    assert.equal(last.status, 429);
  }, { rateLimit: 5 });
});

test("admin export is protected and neutralizes spreadsheet formula cells", async () => {
  await withServer(async ({ origin, repository }) => {
    repository.records.push({
      _id: "synthetic-export-record", createdAt: new Date(), ipMasked: "198.51.100.xxx", ipEncrypted: null,
      geo: { fields: { country: { value: "=2+2" }, region: { value: "Region" }, city: { value: "City" } } },
      device: { category: "desktop", brand: null, model: null }, browser: { name: "Fixture", version: null }, os: { name: "FixtureOS", version: null }
    });
    assert.equal((await fetch(`${origin}/api/admin/export?format=csv`)).status, 401);
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${origin}/api/admin/export?format=xml`, { headers: { Cookie: cookie } })).status, 400);
    const csv = await fetch(`${origin}/api/admin/export?format=csv`, { headers: { Cookie: cookie } });
    const csvText = await csv.text();
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.match(csvText, /'=2\+2/);
    assert.equal(csvText.includes('"=2+2"'), false);
    const json = await fetch(`${origin}/api/admin/export?format=json`, { headers: { Cookie: cookie } });
    assert.equal(json.status, 200);
    assert.equal((await json.json()).data.length, 1);
  });
});

test("invalid and oversized JSON requests return bounded client errors", async () => {
  await withServer(async ({ origin }) => {
    const malformed = await fetch(`${origin}/api/public/intelligence`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid"
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual((await malformed.json()).error, { code: "BAD_REQUEST", message: "The request is invalid." });
    const oversized = await fetch(`${origin}/api/public/intelligence`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(20_000) })
    });
    assert.equal(oversized.status, 413);
  });
});

test("malformed JSON cannot avoid the public route rate-limit bucket", async () => {
  await withServer(async ({ origin }) => {
    const responses = [];
    for (let index = 0; index < 3; index += 1) {
      responses.push(await fetch(`${origin}/api/public/intelligence`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid"
      }));
    }
    assert.deepEqual(responses.map(response => response.status), [400, 400, 429]);
  }, { rateLimit: 2 });
});

test("security headers are sent and health endpoint reveals no internal state", async () => {
  await withServer(async ({ origin }) => {
    const response = await fetch(`${origin}/healthz`);
    const body = await response.json();
    assert.equal(body.status, "ok");
    assert.equal("database" in body, false);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal((await fetch(`${origin}/admin-panel`)).status, 200);
  });
});

test("admin server health reports the configured Neon repository state", async () => {
  await withServer(async ({ origin }) => {
    const secureOrigin = `https://${new URL(origin).host}`;
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: secureOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const response = await fetch(`${origin}/api/admin/server/health`, { headers: { Cookie: cookie } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.storage, "available");
    assert.equal(body.data.database, "available");
  }, { vercelMode: true });
});

test("live refresh uses bounded authenticated polling rather than a long-lived SSE connection", async () => {
  await withServer(async ({ origin }) => {
    const unauthorized = await fetch(`${origin}/api/admin/live`);
    assert.equal(unauthorized.status, 401);
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const response = await fetch(`${origin}/api/admin/live`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const body = await response.json();
    assert.equal(body.data.mode, "polling");
    assert.equal(body.data.intervalMs, 20_000);
    const legacyResponse = await fetch(`${origin}/api/live`, { headers: { Cookie: cookie } });
    assert.equal(legacyResponse.status, 200);
    assert.equal((await legacyResponse.json()).data.mode, "polling");
  });
});

test("temporary staging Basic Auth protects app, visitor collection, admin APIs, and exports while leaving health public", async () => {
  const stagingPassword = "synthetic-staging-access-password-which-is-long-enough";
  const expectedAuthorization = `Basic ${Buffer.from(`rakib-staging:${stagingPassword}`).toString("base64")}`;
  await withServer(async ({ origin, repository, loggedErrors }) => {
    const health = await fetch(`${origin}/healthz`);
    assert.equal(health.status, 200);

    const missing = await fetch(`${origin}/api/public/intelligence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(missing.status, 401);
    assert.match(missing.headers.get("www-authenticate"), /^Basic realm=/);
    assert.equal(repository.records.length, 0);
    assert.equal((await fetch(`${origin}/`)).status, 401);
    assert.equal((await fetch(`${origin}/api/admin/history`)).status, 401);
    assert.equal((await fetch(`${origin}/api/admin/export`)).status, 401);

    for (const authorization of ["Basic invalid", "Bearer token", "Basic !!!", `Basic ${Buffer.from(`rakib-staging:wrong-${stagingPassword}`).toString("base64")}`]) {
      const denied = await fetch(`${origin}/api/public/intelligence`, {
        method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: "{}"
      });
      assert.equal(denied.status, 401);
    }
    assert.equal(repository.records.length, 0);

    const accepted = await fetch(`${origin}/api/public/intelligence`, {
      method: "POST", headers: { Authorization: expectedAuthorization, "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(accepted.status, 201);
    assert.equal(repository.records.length, 1);
    assert.equal((await fetch(`${origin}/api/admin/history`, { headers: { Authorization: expectedAuthorization } })).status, 401);
    const stagingLogin = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: {
        Authorization: expectedAuthorization,
        Origin: `https://${new URL(origin).host}`,
        "Content-Type": "application/json"
      }, body: JSON.stringify({ password })
    });
    assert.equal(stagingLogin.status, 200);
    assert.match(stagingLogin.headers.get("set-cookie"), /; Secure/);
    assert.equal(JSON.stringify(loggedErrors).includes(stagingPassword), false);
  }, { stagingPassword });
});

test("temporary staging access gate rate-limits repeated failed credentials without blocking health", async () => {
  const stagingPassword = "synthetic-staging-access-password-which-is-long-enough";
  await withServer(async ({ origin }) => {
    const statuses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await fetch(`${origin}/`)).status);
    }
    assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  }, { stagingPassword });
});
