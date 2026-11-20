"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeoService } = require("../src/geolocation/geoService");
const { createIpWhoProvider, createGeoProvider, GeoProviderError } = require("../src/geolocation/ipwhoProvider");

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
  assert.deepEqual(result, { ...canonicalGeo, security: { vpn: null, proxy: null, tor: null, hosting: null } });

  const errorProvider = createIpWhoProvider({ fetchImpl: async () => response({}, 503) });
  await assert.rejects(errorProvider.lookup("8.8.8.8"), error => error.code === "http_503" && error.retryable);
  const invalidProvider = createIpWhoProvider({ fetchImpl: async () => response({ success: false }) });
  await assert.rejects(invalidProvider.lookup("8.8.8.8"), error => error.code === "provider_rejected_lookup" && !error.retryable);
});

test("provider falls back to ISP when ipwho has no organization value", async () => {
  const payload = { ...ipwhoPayload, connection: { isp: "Fallback ISP", org: null, asn: "64500" } };
  const provider = createIpWhoProvider({ fetchImpl: async () => response(payload) });
  const result = await provider.lookup("8.8.8.8");
  assert.equal(result.isp, "Fallback ISP");
  assert.equal(result.organization, "Fallback ISP");
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

test("geo service opens a global cooldown on 429 and honors Retry-After", async () => {
  let timestamp = 1000;
  let calls = 0;
  const service = createService(async () => {
    calls += 1;
    if (calls === 1) throw new GeoProviderError("fallback_http_429", { retryAfterMs: 5000 });
    return canonicalGeo;
  }, { now: () => timestamp });
  assert.equal((await service.lookup("8.8.4.4")).errorCode, "fallback_http_429");
  assert.equal(calls, 1);
  assert.equal(service.health().circuitOpen, true);
  assert.equal((await service.lookup("9.9.9.9")).errorCode, "fallback_http_429");
  assert.equal(calls, 1, "other IP lookups must not hit a rate-limited provider");
  timestamp += 5001;
  assert.equal((await service.lookup("9.9.9.9")).status, "available");
  assert.equal(calls, 2);

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


test("geolocation provider falls back to ipapi.co when ipwho.is returns 429", async () => {
  let calls = 0;
  const provider = createGeoProvider("ipwho.is", {
    fetchImpl: async url => {
      calls += 1;
      if (calls === 1) return response({}, 429);
      assert.match(url, /^https:\/\/ipapi\.co\/8\.8\.8\.8\/json\/$/);
      return response({
        ip: "8.8.8.8", country_name: "United States", country_code: "US",
        region: "California", city: "Mountain View", postal: "94035",
        timezone: "America/Los_Angeles", org: "Google LLC", asn: "AS15169",
        latitude: 37.386, longitude: -122.0838
      });
    }
  });
  const result = await provider.lookup("8.8.8.8");
  assert.equal(calls, 2);
  assert.equal(result.country, "United States");
  assert.equal(result.isp, null);
  assert.equal(result.organization, "Google LLC");
  assert.equal(result.asn, "AS15169");
  assert.deepEqual(result.security, { vpn: null, proxy: null, tor: null, hosting: null });
});

test("normalized geolocation retains security signals without inventing unavailable values", async () => {
  const service = createService(async () => ({
    ...canonicalGeo, security: { vpn: false, proxy: true, tor: false, hosting: false }
  }));
  const result = await service.lookup("8.8.8.8");
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.security).map(([key, item]) => [key, item.value])),
    { vpn: false, proxy: true, tor: false, hosting: false }
  );
});
