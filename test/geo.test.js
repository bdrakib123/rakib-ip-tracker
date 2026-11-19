"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeoService } = require("../src/geolocation/geoService");
const { createIpWhoProvider, GeoProviderError } = require("../src/geolocation/ipwhoProvider");

const ipwhoPayload = {
  success: true, country: "Exampleland", country_code: "EX", region: "North", city: "Sample City",
  postal: "10001", timezone: { id: "Etc/UTC" },
  connection: { isp: "Example ISP", org: "Example Org", asn: "64500" },
  latitude: 12.5, longitude: 40.25
};
const canonicalGeo = {
  country: "Exampleland", countryCode: "EX", region: "North", city: "Sample City", postal: "10001",
  timezone: "Etc/UTC", isp: "Example ISP", organization: "Example Org", asn: "64500", latitude: 12.5, longitude: 40.25
};
function response(payload, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: key => headers[key.toLowerCase()] || null }, json: async () => payload };
}
function createService(provider, extra = {}) {
  return createGeoService({ provider: { name: "mock", lookup: provider }, retryCount: 1, sleep: async () => {}, ...extra });
}

test("provider validates HTTP status, success flag, and maps ipwho fields to canonical fields", async () => {
  const provider = createIpWhoProvider({ fetchImpl: async () => response(ipwhoPayload) });
  const result = await provider.lookup("8.8.8.8");
  assert.deepEqual(result, { ...canonicalGeo, security: { vpn: false, proxy: false, tor: false, hosting: false } });

  const errorProvider = createIpWhoProvider({ fetchImpl: async () => response({}, 503) });
  await assert.rejects(errorProvider.lookup("8.8.8.8"), error => error.code === "http_503" && error.retryable);
  const invalidProvider = createIpWhoProvider({ fetchImpl: async () => response({ success: false }) });
  await assert.rejects(invalidProvider.lookup("8.8.8.8"), error => error.code === "provider_rejected_lookup" && !error.retryable);
});

test("provider handles malformed JSON and Retry-After classification", async () => {
  const malformed = createIpWhoProvider({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) });
  await assert.rejects(malformed.lookup("8.8.8.8"), error => error.code === "malformed_json" && error.retryable);
  const rateLimited = createIpWhoProvider({ fetchImpl: async () => response({}, 429, { "retry-after": "5" }) });
  await assert.rejects(rateLimited.lookup("8.8.8.8"), error => error.code === "http_429" && !error.retryable && error.retryAfterMs === 5000);
});

test("geo service validates public, private, invalid and reserved addresses", async () => {
  let calls = 0;
  const service = createService(async () => { calls += 1; return canonicalGeo; });
  assert.equal((await service.lookup("not-an-ip")).errorCode, "invalid_ip");
  assert.equal((await service.lookup("10.1.2.3")).errorCode, "non_public_ip");
  assert.equal((await service.lookup("203.0.113.7")).status, "unavailable");
  assert.equal(calls, 0);
  assert.equal((await service.lookup("8.8.8.8")).fields.country.value, "Exampleland");
  assert.equal(calls, 1);
});

test("geo service preserves individual missing fields and classifies results", async () => {
  const service = createService(async () => ({ country: "Exampleland", countryCode: "EX" }));
  const result = await service.lookup("8.8.8.8");
  assert.equal(result.status, "partial");
  assert.deepEqual(result.fields.country, { value: "Exampleland", status: "available" });
  assert.deepEqual(result.fields.city, { value: null, status: "unavailable" });
});

test("geo service retries retryable failures and classifies exhausted failures", async () => {
  let calls = 0;
  const service = createService(async () => {
    calls += 1;
    throw new GeoProviderError("network_error", { retryable: true });
  });
  const result = await service.lookup("8.8.8.8");
  assert.equal(calls, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "network_error");
  assert.equal(result.fields.city.status, "failed");
});

test("geo service honors provider retry delay and times out via AbortSignal", async () => {
  const delays = [];
  let calls = 0;
  const rateService = createService(async () => {
    calls += 1;
    if (calls === 1) throw new GeoProviderError("http_429", { retryable: true, retryAfterMs: 350 });
    return canonicalGeo;
  }, { sleep: async delay => delays.push(delay) });
  await rateService.lookup("8.8.4.4");
  assert.deepEqual(delays, [350]);

  let delayedRetryCalls = 0;
  const longRetryService = createService(async () => {
    delayedRetryCalls += 1;
    throw new GeoProviderError("http_429", { retryable: true, retryAfterMs: 1500 });
  }, { sleep: async () => assert.fail("must not retry before Retry-After") });
  assert.equal((await longRetryService.lookup("9.9.9.9")).errorCode, "http_429");
  assert.equal(delayedRetryCalls, 1);

  let timeoutCalls = 0;
  const timeoutService = createService((_ip, { signal }) => new Promise((_resolve, reject) => {
    timeoutCalls += 1;
    signal.addEventListener("abort", () => reject(new GeoProviderError("timeout", { retryable: true })), { once: true });
  }), { timeoutMs: 5 });
  const failed = await timeoutService.lookup("1.1.1.1");
  assert.equal(timeoutCalls, 2);
  assert.equal(failed.errorCode, "timeout");
});

test("geo service cache expires and coalesces concurrent same-IP requests", async () => {
  let timestamp = 100;
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const service = createService(async () => { calls += 1; await pending; return canonicalGeo; }, {
    now: () => timestamp, successTtlMs: 10
  });
  const first = service.lookup("8.8.8.8");
  const second = service.lookup("8.8.8.8");
  await new Promise(resolve => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  await service.lookup("8.8.8.8");
  assert.equal(calls, 1);
  timestamp = 110;
  await service.lookup("8.8.8.8");
  assert.equal(calls, 2);
});
