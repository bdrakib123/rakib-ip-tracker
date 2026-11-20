"use strict";

const { GeoProviderError } = require("./ipwhoProvider");

function mapIpApiPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.error) {
    throw new GeoProviderError("provider_rejected_lookup");
  }
  const countryCode = payload.country_code || payload.country || null;
  return {
    country: payload.country_name || null,
    countryCode,
    region: payload.region || null,
    city: payload.city || null,
    postal: payload.postal || null,
    timezone: payload.timezone || null,
    // ipapi.co supplies organization and ASN, but not a distinct ISP field.
    isp: payload.org || null,
    organization: payload.org || null,
    asn: payload.asn || null,
    latitude: Number.isFinite(payload.latitude) ? payload.latitude : null,
    longitude: Number.isFinite(payload.longitude) ? payload.longitude : null,
    security: { vpn: null, proxy: null, tor: null, hosting: null }
  };
}

function createIpApiProvider({ fetchImpl = globalThis.fetch } = {}) {
  return {
    name: "ipapi.co",
    async lookup(ip, { signal } = {}) {
      let response;
      try {
        response = await fetchImpl(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal });
      } catch (error) {
        throw new GeoProviderError(error.name === "AbortError" || error.name === "TimeoutError" ? "timeout" : "network_error", { retryable: true });
      }
      if (!response.ok) {
        throw new GeoProviderError(`fallback_http_${response.status}`, { retryable: response.status >= 500 });
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new GeoProviderError("fallback_malformed_json", { retryable: true });
      }
      return mapIpApiPayload(payload);
    }
  };
}

module.exports = { createIpApiProvider, mapIpApiPayload };
