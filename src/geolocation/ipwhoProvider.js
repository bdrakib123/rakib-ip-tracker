"use strict";

class GeoProviderError extends Error {
  constructor(code, { retryable = false, retryAfterMs = 0 } = {}) {
    super(code);
    this.name = "GeoProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function readRetryAfter(response, now = Date.now) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 5 * 60 * 1000) : 0;
}

function mapIpWhoPayload(payload) {
  const connection = payload.connection || {};
  return {
    country: payload.country || null,
    countryCode: payload.country_code || null,
    region: payload.region || null,
    city: payload.city || null,
    postal: payload.postal || null,
    timezone: payload.timezone?.id || payload.timezone?.utc || null,
    isp: connection.isp || null,
    organization: connection.org || connection.isp || null,
    asn: connection.asn ?? null,
    latitude: Number.isFinite(payload.latitude) ? payload.latitude : null,
    longitude: Number.isFinite(payload.longitude) ? payload.longitude : null,
    security: {
      vpn: typeof payload.security?.vpn === "boolean" ? payload.security.vpn : null,
      proxy: typeof payload.security?.proxy === "boolean" ? payload.security.proxy : null,
      tor: typeof payload.security?.tor === "boolean" ? payload.security.tor : null,
      hosting: typeof payload.security?.hosting === "boolean" ? payload.security.hosting : null
    }
  };
}

function createIpWhoProvider({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return {
    name: "ipwho.is",
    async lookup(ip, { signal } = {}) {
      let response;
      try {
        response = await fetchImpl(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal });
      } catch (error) {
        throw new GeoProviderError(error.name === "AbortError" || error.name === "TimeoutError" ? "timeout" : "network_error", { retryable: true });
      }

      if (!response.ok) {
        const retryAfterMs = response.status === 429 ? readRetryAfter(response, now) : 0;
        const retryable = response.status === 429 || response.status >= 500;
        throw new GeoProviderError(`http_${response.status}`, { retryable: retryable && (!retryAfterMs || retryAfterMs <= 1000), retryAfterMs });
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new GeoProviderError("malformed_json", { retryable: true });
      }
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
  return {
    name: "ipwho.is (fallback: ipapi.co)",
    async lookup(ip, context = {}) {
      try {
        return await primary.lookup(ip, context);
      } catch (error) {
        const shouldFallback = error instanceof GeoProviderError &&
          (error.code === "http_429" || error.retryable);
        if (!shouldFallback) throw error;
        return fallback.lookup(ip, context);
      }
    }
  };
}

module.exports = { GeoProviderError, createGeoProvider, createIpWhoProvider, mapIpWhoPayload };
