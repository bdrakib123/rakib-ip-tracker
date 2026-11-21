"use strict";

class GeoProviderError extends Error {
  constructor(code, { retryable = false, retryAfterMs = 0 } = {}) {
    super(code); this.name = "GeoProviderError"; this.code = code;
    this.retryable = retryable; this.retryAfterMs = retryAfterMs;
  }
}

function readRetryAfter(response, now = Date.now) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 60 * 60 * 1000) : 0;
}

function mapIpWhoPayload(payload) {
  const connection = payload.connection || {};
  return {
    country: payload.country || null, countryCode: payload.country_code || null,
    region: payload.region || null, city: payload.city || null, postal: payload.postal || null,
    timezone: payload.timezone?.id || payload.timezone?.utc || null,
    isp: connection.isp || null, organization: connection.org || connection.isp || null,
    asn: connection.asn ?? null,
    latitude: Number.isFinite(payload.latitude) ? payload.latitude : null,
    longitude: Number.isFinite(payload.longitude) ? payload.longitude : null,
    security: Object.fromEntries(["vpn", "proxy", "tor", "hosting"].map(name => [
      name, typeof payload.security?.[name] === "boolean" ? payload.security[name] : null
    ]))
  };
}

function createIpWhoProvider({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return {
    name: "ipwho.is",
    async lookup(ip, { signal } = {}) {
      let response;
      try { response = await fetchImpl(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal }); }
      catch (error) {
        throw new GeoProviderError(error.name === "AbortError" || error.name === "TimeoutError" ? "timeout" : "network_error", { retryable: true });
      }
      if (!response.ok) {
        const retryAfterMs = response.status === 429 ? readRetryAfter(response, now) : 0;
        throw new GeoProviderError(`http_${response.status}`, {
          retryable: response.status >= 500 || response.status === 429 && retryAfterMs <= 1000, retryAfterMs
        });
      }
      let payload;
      try { payload = await response.json(); }
      catch { throw new GeoProviderError("malformed_json", { retryable: true }); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.success !== true) {
        throw new GeoProviderError("provider_rejected_lookup");
      }
      return mapIpWhoPayload(payload);
    }
  };
}

function createGeoProvider(name, options) {
  if (name !== "ipwho.is") throw new Error(`Unsupported geolocation provider: ${name}`);
  const primary = createIpWhoProvider(options);
  const { createIpApiProvider } = require("./ipApiProvider");
  const fallback = createIpApiProvider(options);
  const now = options?.now || Date.now;
  const primaryCooldownMs = options?.primaryCooldownMs ?? 60 * 1000;
  const maxRetryAfterMs = options?.maxRetryAfterMs ?? 60 * 60 * 1000;
  let primaryCooldownUntil = 0;
  const status = {
    primary: { state: "not_checked", lastErrorCode: null, lastCheckedAt: null, retryAfterMs: 0, cooldownUntil: null },
    fallback: { state: "not_checked", lastErrorCode: null, lastCheckedAt: null, retryAfterMs: 0, cooldownUntil: null }
  };
  async function checked(provider, key, ip, context) {
    try {
      const result = await provider.lookup(ip, context);
      status[key] = { state: "online", lastErrorCode: null, lastCheckedAt: new Date(now()).toISOString(), retryAfterMs: 0 };
      return result;
    } catch (error) {
      const rateLimited = error.code === "http_429" || error.code === "fallback_http_429";
      const retryAfterMs = Number(error.retryAfterMs) || 0;
      status[key] = { state: rateLimited ? "rate_limited" : "error",
        lastErrorCode: error.code || "provider_error", lastCheckedAt: new Date(now()).toISOString(),
        retryAfterMs, cooldownUntil: null };
      if (key === "primary" && error.code === "http_429") {
        const cooldown = Math.min(maxRetryAfterMs, retryAfterMs > 0 ? retryAfterMs : primaryCooldownMs);
        primaryCooldownUntil = Math.max(primaryCooldownUntil, now() + cooldown);
        status.primary.state = "cooling_down";
        status.primary.retryAfterMs = cooldown;
        status.primary.cooldownUntil = new Date(primaryCooldownUntil).toISOString();
      }
      throw error;
    }
  }
  return {
    name: "ipwho.is (fallback: ipapi.co)",
    health: () => {
      if (primaryCooldownUntil && primaryCooldownUntil <= now()) {
        primaryCooldownUntil = 0;
        status.primary = { state: "not_checked", lastErrorCode: null, lastCheckedAt: status.primary.lastCheckedAt, retryAfterMs: 0, cooldownUntil: null };
      }
      return { primary: { ...status.primary }, fallback: { ...status.fallback } };
    },
    async lookup(ip, context = {}) {
      if (primaryCooldownUntil > now()) {
        try { return await checked(fallback, "fallback", ip, context); }
        catch (error) { throw error; }
      }
      if (primaryCooldownUntil && primaryCooldownUntil <= now()) {
        primaryCooldownUntil = 0;
        status.primary = { state: "not_checked", lastErrorCode: null, lastCheckedAt: status.primary.lastCheckedAt, retryAfterMs: 0, cooldownUntil: null };
      }
      try { return await checked(primary, "primary", ip, context); }
      catch (error) {
        if (!(error instanceof GeoProviderError) || !(error.code === "http_429" || error.retryable)) throw error;
        try { return await checked(fallback, "fallback", ip, context); }
        catch (fallbackError) { throw fallbackError; }
      }
    }
  };
}

module.exports = { GeoProviderError, createGeoProvider, createIpWhoProvider, mapIpWhoPayload, readRetryAfter };
