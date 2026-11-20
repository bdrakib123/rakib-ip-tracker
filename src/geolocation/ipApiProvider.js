"use strict";

const { GeoProviderError, readRetryAfter } = require("./ipwhoProvider");

function mapIpApiPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.error) {
    throw new GeoProviderError("provider_rejected_lookup");
  }
  return {
    country: payload.country_name || null, countryCode: payload.country_code || payload.country || null,
    region: payload.region || null, city: payload.city || null, postal: payload.postal || null,
    timezone: payload.timezone || null, isp: null, organization: payload.org || null, asn: payload.asn || null,
    latitude: Number.isFinite(payload.latitude) ? payload.latitude : null,
    longitude: Number.isFinite(payload.longitude) ? payload.longitude : null,
    security: { vpn: null, proxy: null, tor: null, hosting: null }
  };
}

function createIpApiProvider({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return {
    name: "ipapi.co",
    async lookup(ip, { signal } = {}) {
      let response;
      try { response = await fetchImpl(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal }); }
      catch (error) {
        throw new GeoProviderError(error.name === "AbortError" || error.name === "TimeoutError" ? "timeout" : "network_error", { retryable: true });
      }
      if (!response.ok) {
        const retryAfterMs = response.status === 429 ? readRetryAfter(response, now) : 0;
        throw new GeoProviderError(`fallback_http_${response.status}`, {
          retryable: response.status >= 500 || response.status === 429 && retryAfterMs <= 1000, retryAfterMs
        });
      }
      let payload;
      try { payload = await response.json(); }
      catch { throw new GeoProviderError("fallback_malformed_json", { retryable: true }); }
      return mapIpApiPayload(payload);
    }
  };
}

module.exports = { createIpApiProvider, mapIpApiPayload };
