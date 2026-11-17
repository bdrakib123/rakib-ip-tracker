"use strict";

const { isIP } = require("node:net");
const UAParser = require("ua-parser-js");

const GEO_CACHE_TTL_MS = 15 * 60 * 1000;
const GEO_FAILURE_CACHE_TTL_MS = 30 * 1000;
const GEO_CACHE_MAX_ENTRIES = 500;

function normalizeIP(ip) {
  const value = String(ip || "").trim();
  if (value.startsWith("::ffff:")) return value.slice(7);
  if (value === "::1") return "127.0.0.1";
  return value;
}

function ipv4Octets(ip) {
  return ip.split(".").map(Number);
}

function isNonPublicIPv4(ip) {
  const [a, b, c] = ipv4Octets(ip);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

function isPrivateIP(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ipv4Octets(ip);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  if (isIP(ip) !== 6) return false;
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    return isPrivateIP(mapped);
  }
  return groups.every(group => group === 0) ||
    (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) ||
    (groups[0] & 0xfe00) === 0xfc00 ||
    (groups[0] & 0xffc0) === 0xfe80;
}

function ipv6Groups(ip) {
  const halves = ip.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map(group => parseInt(group || "0", 16));
}

function isNonPublicIP(ip) {
  if (isIP(ip) === 4) return isNonPublicIPv4(ip);
  if (isIP(ip) !== 6) return true;

  const groups = ipv6Groups(ip);
  if (!groups) return true;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    return isNonPublicIPv4(mapped);
  }
  return groups.every(group => group === 0) ||
    (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) ||
    (groups[0] & 0xfe00) === 0xfc00 || // unique local
    (groups[0] & 0xffc0) === 0xfe80 || // link local
    (groups[0] & 0xffc0) === 0xfec0 || // deprecated site local
    (groups[0] & 0xff00) === 0xff00 || // multicast
    (groups[0] === 0x2001 && groups[1] === 0x0db8); // documentation range
}

function unavailableGeo() {
  return {
    country: "Unknown",
    countryCode: "",
    region: "Unknown",
    city: "Unknown",
    postal: "",
    timezone: "",
    isp: "Unknown",
    organization: "Unknown",
    asn: "Unknown",
    latitude: null,
    longitude: null,
    security: {
      vpn: false,
      proxy: false,
      tor: false,
      hosting: false,
      source: "unavailable"
    }
  };
}

function localGeo() {
  return {
    country: "Local",
    countryCode: "",
    region: "Local",
    city: "Local",
    postal: "",
    timezone: "",
    isp: "",
    organization: "",
    asn: "",
    latitude: null,
    longitude: null
  };
}

function providerGeo(data) {
  const connection = data.connection || {};
  const rawAsn = connection.asn;
  const asn = rawAsn == null || rawAsn === ""
    ? "Unknown"
    : /^AS/i.test(String(rawAsn)) ? String(rawAsn) : `AS${rawAsn}`;

  return {
    country: data.country || "Unknown",
    countryCode: data.country_code || "",
    region: data.region || "Unknown",
    city: data.city || "Unknown",
    postal: data.postal || "",
    timezone: typeof data.timezone === "string"
      ? data.timezone
      : data.timezone?.id || data.timezone?.utc || "",
    isp: connection.isp || "Unknown",
    organization: connection.org || connection.isp || "Unknown",
    asn,
    latitude: Number.isFinite(data.latitude) ? data.latitude : null,
    longitude: Number.isFinite(data.longitude) ? data.longitude : null,
    security: {
      vpn: !!data.security?.vpn,
      proxy: !!data.security?.proxy,
      tor: !!data.security?.tor,
      hosting: !!data.security?.hosting,
      source: "ipwho.is"
    }
  };
}

function createGeoLookup({
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  retryDelayMs = 200,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  logger = console,
  cacheTtlMs = GEO_CACHE_TTL_MS,
  failureCacheTtlMs = GEO_FAILURE_CACHE_TTL_MS,
  maxCacheEntries = GEO_CACHE_MAX_ENTRIES
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function lookup(ip) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(
          `https://ipwho.is/${encodeURIComponent(ip)}`,
          { signal: AbortSignal.timeout(timeoutMs) }
        );

        if (!response.ok) {
          const error = new Error(`HTTP_${response.status}`);
          error.retryable = response.status === 429 || response.status >= 500;
          if (response.status === 429) {
            const retryAfter = response.headers?.get?.("retry-after");
            if (retryAfter) {
              const seconds = Number(retryAfter);
              const dateDelay = Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(retryAfter) - Date.now();
              if (Number.isFinite(dateDelay) && dateDelay >= 0) {
                error.retryAfterMs = dateDelay;
                error.retryable = dateDelay <= 1000;
              }
            }
          }
          throw error;
        }

        let data;
        try {
          data = await response.json();
        } catch {
          const error = new Error("MALFORMED_JSON");
          error.retryable = true;
          throw error;
        }

        if (!data || typeof data !== "object" || data.success !== true) {
          const error = new Error("PROVIDER_REJECTED_LOOKUP");
          error.retryable = false;
          throw error;
        }

        return { data: providerGeo(data), ttl: cacheTtlMs };
      } catch (error) {
        const retryable = error.retryable !== false;
        if (attempt === 0 && retryable) {
          const retryAfter = Number(error.retryAfterMs);
          await sleep(Number.isFinite(retryAfter) ? Math.max(0, Math.min(retryAfter, 1000)) : retryDelayMs);
          continue;
        }
        const reason = error.name === "TimeoutError" || error.name === "AbortError"
          ? "timeout"
          : /^HTTP_\d{3}$/.test(error.message)
            ? error.message
            : error.message === "PROVIDER_REJECTED_LOOKUP" || error.message === "MALFORMED_JSON"
              ? error.message
              : error.name || "provider_error";
        logger.warn?.("Geolocation lookup unavailable:", reason);
        const retryAfterTtl = Math.min(error.retryAfterMs || 0, 5 * 60 * 1000);
        return { data: unavailableGeo(), ttl: Math.max(failureCacheTtlMs, retryAfterTtl) };
      }
    }
    return { data: unavailableGeo(), ttl: failureCacheTtlMs };
  }

  return async function getGeoData(rawIP) {
    const ip = normalizeIP(rawIP);
    const ipType = isIP(ip);
    if (!ipType) return unavailableGeo();
    if (isPrivateIP(ip)) return localGeo();
    if (isNonPublicIP(ip)) return unavailableGeo();

    const timestamp = now();
    const cached = cache.get(ip);
    if (cached && cached.expiresAt > timestamp) return cached.data;
    if (cached) cache.delete(ip);
    if (inFlight.has(ip)) return inFlight.get(ip);

    const request = lookup(ip).then(({ data, ttl }) => {
      if (cache.size >= maxCacheEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(ip, { data, expiresAt: now() + ttl });
      return data;
    }).finally(() => {
      if (inFlight.get(ip) === request) inFlight.delete(ip);
    });
    inFlight.set(ip, request);
    return request;
  };
}

const getGeoData = createGeoLookup();

function fallbackDeviceType(userAgent) {
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return "mobile";
  return "desktop";
}

function parseUserAgent(userAgent, Parser = UAParser) {
  const value = String(userAgent || "");
  let result = {};
  try {
    result = new Parser(value).getResult() || {};
  } catch {
    // Geo lookup and visitor persistence must not depend on UA parser success.
  }

  let deviceType = result.device?.type || fallbackDeviceType(value);
  let deviceVendor = result.device?.vendor || "";
  let deviceModel = result.device?.model || "";

  if (/^(unknown|generic smartphone|smartphone|mobile|k|a)$/i.test(deviceModel)) {
    deviceModel = "";
  }

  if (!deviceModel) {
    const match = value.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build[\/;]|[;)])/i);
    const candidate = match?.[1]?.trim() || "";
    if (candidate.length >= 2 && candidate.length < 80 &&
      !/^(Linux|Android|Mobile|wv|Build|K|A)$/i.test(candidate)) {
      deviceModel = candidate;
    }
  }

  if (!deviceVendor || /^unknown$/i.test(deviceVendor)) {
    const model = deviceModel.toLowerCase();
    if (/xiaomi|redmi|poco|^22\d{4}|^23\d{4}|^24\d{4}|^25\d{4}|^26\d{4}/i.test(model)) deviceVendor = "Xiaomi";
    else if (/samsung|galaxy|^sm-/i.test(model)) deviceVendor = "Samsung";
    else if (/pixel/i.test(model)) deviceVendor = "Google";
    else if (/realme|^rmx/i.test(model)) deviceVendor = "realme";
    else if (/vivo/i.test(model)) deviceVendor = "vivo";
    else if (/oppo|^cph/i.test(model)) deviceVendor = "OPPO";
    else if (/oneplus/i.test(model)) deviceVendor = "OnePlus";
    else if (/huawei|honor/i.test(model)) deviceVendor = "Huawei/Honor";
  }

  return {
    device: {
      type: deviceType || "desktop",
      vendor: deviceVendor || "Unknown",
      model: deviceModel || "Unknown"
    },
    os: {
      name: result.os?.name || "Unknown",
      version: result.os?.version || ""
    },
    browser: {
      name: result.browser?.name || "Unknown",
      version: result.browser?.version || ""
    },
    engine: {
      name: result.engine?.name || "Unknown",
      version: result.engine?.version || ""
    },
    userAgent: value || "Unknown"
  };
}

function unavailableUserAgent(userAgent) {
  return {
    device: { type: fallbackDeviceType(String(userAgent || "")), vendor: "Unknown", model: "Unknown" },
    os: { name: "Unknown", version: "" },
    browser: { name: "Unknown", version: "" },
    engine: { name: "Unknown", version: "" },
    userAgent: String(userAgent || "Unknown")
  };
}

async function collectVisitorData(ip, userAgent, {
  geoLookup = getGeoData,
  uaParser = parseUserAgent,
  logger = console
} = {}) {
  const [geoResult, uaResult] = await Promise.allSettled([
    Promise.resolve().then(() => geoLookup(ip)),
    Promise.resolve().then(() => uaParser(userAgent))
  ]);

  if (geoResult.status === "rejected") {
    logger.warn?.("Geolocation lookup unavailable:", "lookup_error");
  }
  return {
    geo: geoResult.status === "fulfilled" ? geoResult.value : unavailableGeo(),
    ua: uaResult.status === "fulfilled" ? uaResult.value : unavailableUserAgent(userAgent)
  };
}

function visitorGeo(visitor) {
  const geo = visitor?.geo || visitor?.geolocation || visitor?.location || {};
  return {
    ...geo,
    country: geo.country ?? visitor?.country ?? "Unknown",
    countryCode: geo.countryCode ?? geo.country_code ?? visitor?.countryCode ?? "",
    region: geo.region ?? geo.regionName ?? visitor?.region ?? "Unknown",
    city: geo.city ?? visitor?.city ?? "Unknown",
    postal: geo.postal ?? geo.postalCode ?? visitor?.postal ?? "",
    timezone: geo.timezone ?? geo.time_zone ?? visitor?.timezone ?? "",
    isp: geo.isp ?? geo.provider ?? geo.org ?? visitor?.isp ?? "Unknown",
    organization: geo.organization ?? geo.org ?? visitor?.organization ?? "Unknown",
    asn: geo.asn ?? geo.as ?? visitor?.asn ?? "Unknown",
    latitude: geo.latitude ?? geo.lat ?? visitor?.latitude ?? null,
    longitude: geo.longitude ?? geo.lon ?? visitor?.longitude ?? null
  };
}

function publicHistoryVisitorResponse(visitor) {
  const geo = visitorGeo(visitor);
  return {
    id: String(visitor._id),
    ip: visitor.ipMasked || "Unavailable",
    geo: {
      city: geo.city,
      region: geo.region,
      country: geo.country,
      countryCode: geo.countryCode,
      timezone: geo.timezone
    },
    device: visitor.device || {},
    os: visitor.os || {},
    browser: visitor.browser || {},
    engine: visitor.engine || {},
    timestamp: visitor.createdAt
  };
}

module.exports = {
  collectVisitorData,
  createGeoLookup,
  getGeoData,
  isNonPublicIP,
  parseUserAgent,
  publicHistoryVisitorResponse,
  visitorGeo
};
