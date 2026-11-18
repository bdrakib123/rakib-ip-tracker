"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { createVisitorService } = require("../src/services/visitorService");
const { detectDevice } = require("../src/device/detectDevice");
const { GeoProviderError } = require("../src/geolocation/ipwhoProvider");

const key = "0123456789abcdef".repeat(4);
const password = "rebuild-test-password-strong";

function makeRepository() {
  const records = [];
  return {
    records,
    async countByIpHash() { return 0; },
    async insert(document) { const saved = { ...document, _id: `fake-${records.length + 1}` }; records.push(saved); return saved; },
    async history({ page = 1, limit = 50 } = {}) {
      return { page: Number(page), limit: Number(limit), total: records.length, pages: 1, data: records };
    },
    async findById(id) { return records.find(record => String(record._id) === id) || null; },
    async overview() { return { totalVisitors: records.length, last24h: records.length, countries: [], devices: [], browsers: [], operatingSystems: [], daily: [] }; },
    async ping() { return true; }
  };
}

async function withServer(fn, { rateLimit = 30, trustProxyHops = 0, stagingPassword = null } = {}) {
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
    ...(stagingPassword ? { stagingMode: true, stagingAccessPassword: stagingPassword, secureCookies: true } : {}) };
  const app = createApp({ config, repository, visitorService, geoService, analytics: { overview: () => repository.overview(), providerHealth: () => geoService.health() }, logger: { error(...args) { loggedErrors.push(args); } } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ origin, repository, visitorService, server, app, activeSSEListeners: () => activeSSEListeners, loggedErrors }); }
  finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
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

test("admin login enables protected API access and logout revokes the server session", async () => {
  await withServer(async ({ origin }) => {
    const denied = await fetch(`${origin}/api/admin/analytics/overview`);
    assert.equal(denied.status, 401);
    assert.equal((await fetch(`${origin}/api/admin/live`)).status, 401);
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

test("security headers are sent and health endpoint reveals no internal state", async () => {
  await withServer(async ({ origin }) => {
    const response = await fetch(`${origin}/healthz`);
    const body = await response.json();
    assert.equal(body.status, "ok");
    assert.equal("database" in body, false);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  });
});

test("authenticated SSE streams only on an admin session and cleans up on disconnect", async () => {
  await withServer(async ({ origin, activeSSEListeners }) => {
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const response = await fetch(`${origin}/api/admin/live`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.equal(activeSSEListeners(), 1);
    const reader = response.body.getReader();
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /event: ready/);
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(activeSSEListeners(), 0);
  });
});

test("server shutdown hook closes admin SSE clients and unsubscribes listeners", async () => {
  await withServer(async ({ origin, app, activeSSEListeners }) => {
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const response = await fetch(`${origin}/api/admin/live`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(activeSSEListeners(), 1);
    app.locals.closeAdminStreams();
    const text = await response.text();
    assert.match(text, /event: ready/);
    assert.equal(activeSSEListeners(), 0);
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
