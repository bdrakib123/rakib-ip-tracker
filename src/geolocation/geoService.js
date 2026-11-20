"use strict";

const { isIP } = require("node:net");
const { isNonPublicIP, isPrivateIP, normalizeIP } = require("../lib/ip");
const { GeoProviderError } = require("./ipwhoProvider");

const FIELDS = ["country", "countryCode", "region", "city", "postal", "timezone", "isp", "organization", "asn", "latitude", "longitude"];

function field(value, status = value === null || value === "" || value === undefined ? "unavailable" : "available") {
  return { value: value === undefined || value === "" ? null : value, status };
}

function unavailableGeo(status, code = null) {
  return {
    status, precision: "approximate", source: null, errorCode: code,
    fields: Object.fromEntries(FIELDS.map(name => [name, field(null, status === "failed" ? "failed" : "unavailable")]))
  };
}

function normalizeGeo(payload, providerName) {
  const timezone = typeof payload.timezone === "string" ? payload.timezone : payload.timezone?.id || payload.timezone?.utc || null;
  const rawAsn = payload.asn;
  const asn = rawAsn == null || rawAsn === "" ? null : (/^AS/i.test(String(rawAsn)) ? String(rawAsn) : `AS${rawAsn}`);
  const values = {
    country: payload.country || null, countryCode: payload.countryCode || null, region: payload.region || null,
    city: payload.city || null, postal: payload.postal || null, timezone, isp: payload.isp || null,
    organization: payload.organization || null, asn,
    latitude: Number.isFinite(payload.latitude) ? payload.latitude : null,
    longitude: Number.isFinite(payload.longitude) ? payload.longitude : null
  };
  const fields = Object.fromEntries(FIELDS.map(name => [name, field(values[name])]));
  const available = Object.values(fields).filter(item => item.status === "available").length;
  return {
    status: resultStatus(available, FIELDS.length), precision: "approximate", source: providerName, errorCode: null, fields,
    security: Object.fromEntries(["vpn", "proxy", "tor", "hosting"].map(name => [
      name, field(typeof payload.security?.[name] === "boolean" ? payload.security[name] : null)
    ]))
  };
}

function resultStatus(available, total) {
  return available === total ? "available" : available ? "partial" : "unavailable";
}

function createGeoService({
  provider, timeoutMs = 5000, retryCount = 1, successTtlMs = 15 * 60 * 1000,
  failureTtlMs = 5 * 60 * 1000, maxEntries = 500, providerCooldownMs = 60 * 1000,
  maxRetryAfterMs = 60 * 60 * 1000, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (!provider || typeof provider.lookup !== "function") throw new Error("A geolocation provider with lookup(ip) is required");
  const cache = new Map();
  const inFlight = new Map();
  const health = { state: "not_checked", lastCheckedAt: null, lastErrorCode: null, cooldownUntil: null };
  let circuitOpenUntil = 0;
  let circuitErrorCode = null;

  function openCircuit(error) {
    const retryAfter = Number(error?.retryAfterMs) || 0;
    const delay = Math.min(maxRetryAfterMs, retryAfter > 0 ? retryAfter : providerCooldownMs);
    circuitOpenUntil = Math.max(circuitOpenUntil, now() + delay);
    circuitErrorCode = error?.code || "provider_cooldown";
    health.cooldownUntil = new Date(circuitOpenUntil).toISOString();
  }

  async function providerLookup(ip) {
    let lastError;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const payload = await provider.lookup(ip, { signal: AbortSignal.timeout(timeoutMs) });
        const result = normalizeGeo(payload, provider.name || "configured provider");
        health.state = result.status === "unavailable" ? "partial" : "online";
        health.lastCheckedAt = new Date(now()).toISOString();
        health.lastErrorCode = null;
        return { value: result, ttl: successTtlMs };
      } catch (error) {
        lastError = error instanceof GeoProviderError ? error :
          new GeoProviderError(error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "provider_error", { retryable: true });
        const rateLimited = lastError.code === "http_429" || lastError.code === "fallback_http_429";
        if (rateLimited) {
          openCircuit(lastError);
          break;
        }
        const retryDelay = lastError.retryAfterMs || 0;
        const canRetry = lastError.retryable && attempt < retryCount && retryDelay <= 1000;
        if (!canRetry) break;
        await sleep(retryDelay || 200 * (attempt + 1));
      }
    }
    health.state = "error";
    health.lastCheckedAt = new Date(now()).toISOString();
    health.lastErrorCode = lastError?.code || "provider_error";
    return { value: unavailableGeo("failed", health.lastErrorCode), ttl: failureTtlMs };
  }

  async function lookup(rawIP) {
    const ip = normalizeIP(rawIP);
    if (!isIP(ip) || isPrivateIP(ip) || isNonPublicIP(ip)) {
      return unavailableGeo("unavailable", isIP(ip) ? "non_public_ip" : "invalid_ip");
    }
    const timestamp = now();
    const cached = cache.get(ip);
    if (cached && cached.expiresAt > timestamp) return cached.value;
    if (cached) cache.delete(ip);
    if (inFlight.has(ip)) return inFlight.get(ip);

    if (circuitOpenUntil > timestamp) {
      return unavailableGeo("failed", circuitErrorCode || "provider_cooldown");
    }
    if (circuitOpenUntil && circuitOpenUntil <= timestamp) {
      circuitOpenUntil = 0;
      circuitErrorCode = null;
      health.cooldownUntil = null;
    }

    const pending = providerLookup(ip).then(({ value, ttl }) => {
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(ip, { value, expiresAt: now() + ttl });
      return value;
    }).finally(() => {
      if (inFlight.get(ip) === pending) inFlight.delete(ip);
    });
    inFlight.set(ip, pending);
    return pending;
  }

  return {
    lookup,
    health() {
      return { provider: provider.name || "configured provider", ...health, circuitOpen: circuitOpenUntil > now(),
        providers: typeof provider.health === "function" ? provider.health() : undefined };
    }
  };
}

module.exports = { createGeoService, normalizeGeo, unavailableGeo };
