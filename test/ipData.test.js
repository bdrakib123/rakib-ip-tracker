"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  collectVisitorData,
  createGeoLookup,
  parseUserAgent,
  publicHistoryVisitorResponse,
  visitorGeo
} = require("../lib/ipData");

const exampleGeo = {
  success: true,
  country: "Exampleland",
  country_code: "EX",
  region: "North",
  city: "Sample City",
  postal: "12345",
  timezone: { id: "Etc/UTC" },
  connection: { isp: "Example ISP", org: "Example Org", asn: "64500" },
  latitude: 12.5,
  longitude: 40.25,
  security: { vpn: false }
};

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

function quietLogger() {
  return { warnings: [], warn(...args) { this.warnings.push(args); } };
}

test("maps ipwho.is success fields and caches successful lookups", async () => {
  let calls = 0;
  const getGeoData = createGeoLookup({
    fetchImpl: async () => { calls += 1; return response(exampleGeo); },
    retryDelayMs: 0,
    logger: quietLogger()
  });

  const first = await getGeoData("8.8.8.8");
  const second = await getGeoData("8.8.8.8");
  assert.equal(first.country, "Exampleland");
  assert.equal(first.isp, "Example ISP");
  assert.equal(first.asn, "AS64500");
  assert.equal(first.latitude, 12.5);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test("expires cached geo data and fetches again", async () => {
  let timestamp = 100;
  let calls = 0;
  const getGeoData = createGeoLookup({
    fetchImpl: async () => { calls += 1; return response(exampleGeo); },
    cacheTtlMs: 10,
    now: () => timestamp,
    retryDelayMs: 0,
    logger: quietLogger()
  });
  await getGeoData("8.8.4.4");
  timestamp = 109;
  await getGeoData("8.8.4.4");
  assert.equal(calls, 1);
  timestamp = 110;
  await getGeoData("8.8.4.4");
  assert.equal(calls, 2);
});

test("coalesces concurrent lookups for the same IP", async () => {
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const getGeoData = createGeoLookup({
    fetchImpl: async () => { calls += 1; await pending; return response(exampleGeo); },
    retryDelayMs: 0,
    logger: quietLogger()
  });
  const first = getGeoData("8.8.8.8");
  const second = getGeoData("8.8.8.8");
  await new Promise(resolve => setImmediate(resolve));
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
});

test("does not send invalid, private, local, or reserved IPs to the provider", async () => {
  let calls = 0;
  const getGeoData = createGeoLookup({
    fetchImpl: async () => { calls += 1; return response(exampleGeo); },
    logger: quietLogger()
  });
  assert.equal((await getGeoData("not-an-ip")).country, "Unknown");
  assert.equal((await getGeoData("127.0.0.1")).country, "Local");
  assert.equal((await getGeoData("172.20.4.9")).city, "Local");
  assert.equal((await getGeoData("192.168.1.4")).country, "Local");
  assert.equal((await getGeoData("::1")).country, "Local");
  assert.equal((await getGeoData("fd12::1")).country, "Local");
  assert.equal((await getGeoData("169.254.1.1")).country, "Local");
  assert.equal((await getGeoData("203.0.113.10")).country, "Unknown");
  assert.equal(calls, 0);
});

test("retries provider rate limits and server errors once", async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    const logger = quietLogger();
    const getGeoData = createGeoLookup({
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? response({}, { ok: false, status }) : response(exampleGeo);
      },
      retryDelayMs: 0,
      logger
    });
    assert.equal((await getGeoData("8.8.8.8")).country, "Exampleland");
    assert.equal(calls, 2);
    assert.equal(logger.warnings.length, 0);
  }
});

test("honors short Retry-After values and avoids retrying before long ones", async () => {
  const delays = [];
  let calls = 0;
  const quickRetry = createGeoLookup({
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? { ...response({}, { ok: false, status: 429 }), headers: { get: () => "0.25" } }
        : response(exampleGeo);
    },
    sleep: async delay => { delays.push(delay); },
    logger: quietLogger()
  });
  assert.equal((await quickRetry("8.8.8.8")).country, "Exampleland");
  assert.deepEqual(delays, [250]);

  let timestamp = 0;
  let longWaitCalls = 0;
  const longRetryAfter = createGeoLookup({
    fetchImpl: async () => {
      longWaitCalls += 1;
      return { ...response({}, { ok: false, status: 429 }), headers: { get: () => "5" } };
    },
    failureCacheTtlMs: 1,
    now: () => timestamp,
    sleep: async () => assert.fail("must not retry before Retry-After"),
    logger: quietLogger()
  });
  await longRetryAfter("8.8.4.4");
  await longRetryAfter("8.8.4.4");
  assert.equal(longWaitCalls, 1);
  timestamp = 5000;
  await longRetryAfter("8.8.4.4");
  assert.equal(longWaitCalls, 2);
});

test("does not retry invalid IP/provider rejection responses", async () => {
  for (const payload of [{ success: false, message: "invalid IP" }, { error: "missing success" }]) {
    let calls = 0;
    const getGeoData = createGeoLookup({
      fetchImpl: async () => { calls += 1; return response(payload); },
      retryDelayMs: 0,
      logger: quietLogger()
    });
    assert.equal((await getGeoData("8.8.8.8")).country, "Unknown");
    assert.equal(calls, 1);
  }
  let calls = 0;
  const httpClientError = createGeoLookup({
    fetchImpl: async () => { calls += 1; return response({}, { ok: false, status: 400 }); },
    retryDelayMs: 0,
    logger: quietLogger()
  });
  await httpClientError("8.8.8.8");
  assert.equal(calls, 1);
});

test("retries malformed JSON and returns only available fields", async () => {
  let calls = 0;
  const getGeoData = createGeoLookup({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } };
      return response({ success: true, country: "Exampleland", country_code: "EX" });
    },
    retryDelayMs: 0,
    logger: quietLogger()
  });
  const geo = await getGeoData("8.8.8.8");
  assert.equal(calls, 2);
  assert.equal(geo.country, "Exampleland");
  assert.equal(geo.city, "Unknown");
  assert.equal(geo.isp, "Unknown");
  assert.equal(geo.latitude, null);
  assert.equal(geo.longitude, null);
});

test("times out and retries before returning unavailable geo", async () => {
  let calls = 0;
  const logger = quietLogger();
  const getGeoData = createGeoLookup({
    timeoutMs: 5,
    retryDelayMs: 0,
    logger,
    fetchImpl: (_url, { signal }) => {
      calls += 1;
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          reject(error);
        }, { once: true });
        signal.throwIfAborted();
      });
    }
  });
  assert.equal((await getGeoData("8.8.8.8")).country, "Unknown");
  assert.equal(calls, 2);
  assert.deepEqual(logger.warnings, [["Geolocation lookup unavailable:", "timeout"]]);
});

test("uses a short failure cache to avoid hammering a limited provider", async () => {
  let timestamp = 0;
  let calls = 0;
  const getGeoData = createGeoLookup({
    fetchImpl: async () => { calls += 1; return response({}, { ok: false, status: 429 }); },
    failureCacheTtlMs: 25,
    now: () => timestamp,
    retryDelayMs: 0,
    logger: quietLogger()
  });
  await getGeoData("8.8.8.8");
  await getGeoData("8.8.8.8");
  assert.equal(calls, 2); // one initial request and one retry, then cached failure
  timestamp = 25;
  await getGeoData("8.8.8.8");
  assert.equal(calls, 4);
});

test("geo failure does not prevent browser, OS, or device parsing", async () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const data = await collectVisitorData("8.8.8.8", ua, {
    geoLookup: async () => { throw new Error("synthetic provider failure"); },
    logger: quietLogger()
  });
  assert.equal(data.geo.country, "Unknown");
  assert.equal(data.ua.browser.name, "Chrome");
  assert.equal(data.ua.os.name, "Windows");
  assert.equal(data.ua.device.type, "desktop");
});

test("UA parser failure does not discard valid geolocation", async () => {
  const data = await collectVisitorData("8.8.8.8", "Android 14", {
    geoLookup: async () => ({ country: "Exampleland", city: "Sample City" }),
    uaParser: () => { throw new Error("synthetic parser failure"); },
    logger: quietLogger()
  });
  assert.equal(data.geo.city, "Sample City");
  assert.equal(data.ua.device.type, "mobile");
  assert.equal(data.ua.browser.name, "Unknown");
});

test("recognizes representative phone, tablet, and desktop User-Agents", () => {
  const cases = [
    ["Redmi 10C", "Mozilla/5.0 (Linux; Android 11; Redmi 10C Build/RP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile"],
    ["Redmi Note", "Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile"],
    ["Samsung Galaxy", "Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile"],
    ["Google Pixel", "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile"],
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "mobile"],
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "tablet"],
    ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "desktop"],
    ["Linux", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "desktop"],
    ["macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "desktop"],
    ["Android tablet", "Mozilla/5.0 (Linux; Android 13; SM-X700 Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "tablet"]
  ];

  for (const [label, ua, expectedType] of cases) {
    const result = parseUserAgent(ua);
    assert.equal(result.device.type, expectedType, `${label} device type`);
    assert.notEqual(result.browser.name, "Unknown", `${label} browser`);
    assert.notEqual(result.os.name, "Unknown", `${label} operating system`);
  }
  assert.match(parseUserAgent(cases[0][1]).device.model, /Redmi 10C/i);
  assert.match(parseUserAgent(cases[1][1]).device.vendor, /Xiaomi/i);
  assert.match(parseUserAgent(cases[2][1]).device.model, /SM-S921B/i);
  assert.match(parseUserAgent(cases[3][1]).device.model, /Pixel 8 Pro/i);
  assert.equal(parseUserAgent("Mozilla/5.0 (Linux; Android 13; K Build/ABC) Mobile").device.model, "Unknown");
});

test("public history supports current and legacy fields without exposing private geo or IP", () => {
  const samples = [
    { _id: "current", ip: "198.51.100.23", ipMasked: "198.51.100.*", ipEncrypted: "secret", geo: { city: "Current City", isp: "Private ISP", organization: "Private Org", latitude: 1, longitude: 2 }, device: { type: "mobile" } },
    { _id: "legacy", ip: "203.0.113.42", ipMasked: "203.0.113.*", country: "Legacyland", region: "West", city: "Legacy City", isp: "Legacy ISP", latitude: 3, longitude: 4 }
  ];
  for (const record of samples) {
    const result = publicHistoryVisitorResponse(record);
    const serialized = JSON.stringify(result);
    assert.equal(result.ip, record.ipMasked);
    assert.equal("isp" in result.geo, false);
    assert.equal("organization" in result.geo, false);
    assert.equal("latitude" in result.geo, false);
    assert.equal("longitude" in result.geo, false);
    assert.equal(serialized.includes(record.ip), false);
    assert.equal(serialized.includes("Private ISP"), false);
    assert.equal(serialized.includes("Legacy ISP"), false);
  }
  assert.equal(visitorGeo(samples[1]).city, "Legacy City");
});

test("admin history remains protected by requireAdmin", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.get\("\/api\/admin\/history",\s*requireAdmin,/);
});
