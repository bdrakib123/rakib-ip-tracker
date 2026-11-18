"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { isIP } = require("node:net");
const { getRequestIP, maskIP, normalizeIP } = require("../lib/ip");
const { validateClientSignals } = require("../lib/validateClientSignals");
const { unavailableGeo } = require("../geolocation/geoService");

function encryptIP(ip, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const data = Buffer.concat([cipher.update(ip, "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function decryptIP(payload, keyHex) {
  if (!payload || payload.algorithm && payload.algorithm !== "aes-256-gcm") return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const ip = Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
    return isIP(ip) ? normalizeIP(ip) : null;
  } catch {
    return null;
  }
}

function storedGeo(geo) {
  return Object.fromEntries(Object.entries(geo.fields || {}).map(([key, item]) => [key, item.value]));
}

function geoFromRecord(record) {
  const geo = record.geo || record.geolocation || record.location || {};
  if (geo.fields) return geo;
  const status = record.geoStatus?.status || (geo.country || geo.city ? "partial" : "unavailable");
  const values = {
    country: geo.country ?? record.country,
    countryCode: geo.countryCode ?? geo.country_code ?? record.countryCode ?? record.country_code,
    region: geo.region ?? geo.regionName ?? record.region ?? record.regionName,
    city: geo.city ?? record.city,
    postal: geo.postal ?? geo.postalCode ?? record.postal ?? record.postalCode,
    timezone: geo.timezone ?? geo.time_zone ?? record.timezone ?? record.time_zone,
    isp: geo.isp ?? geo.provider ?? geo.org ?? record.isp ?? record.provider ?? record.org,
    organization: geo.organization ?? geo.org ?? record.organization ?? record.org,
    asn: geo.asn ?? geo.as ?? record.asn ?? record.as,
    latitude: geo.latitude ?? geo.lat ?? record.latitude ?? record.lat,
    longitude: geo.longitude ?? geo.lon ?? record.longitude ?? record.lon
  };
  const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, {
    value: value === undefined || value === "" ? null : value,
    status: value === undefined || value === "" || value === null
      ? (record.geoStatus?.status === "failed" ? "failed" : "unavailable")
      : "available"
  }]));
  return { status, precision: "approximate", source: geo.source || null, errorCode: null, fields };
}

function deviceFromRecord(record) {
  const device = record.device || {};
  return {
    category: device.category || device.type || "unknown",
    brand: device.brand || device.vendor || null,
    model: device.model && !/^unknown$/i.test(device.model) ? device.model : null,
    status: device.status || (device.model && !/^unknown$/i.test(device.model) ? "available" : "partial")
  };
}

function publicVisitor(record) {
  const geo = geoFromRecord(record);
  const coarseFields = Object.fromEntries(["country", "countryCode", "region", "city", "timezone"].map(key => [key, geo.fields[key]]));
  return {
    ip: record.ipMasked || "Unavailable",
    geo: { status: geo.status, precision: "approximate", fields: coarseFields },
    timestamp: record.createdAt
  };
}

function adminVisitor(record, keyHex) {
  return {
    ...publicVisitor(record),
    id: String(record._id),
    ip: decryptIP(record.ipEncrypted, keyHex) || record.ipMasked || "Unavailable",
    maskedIP: record.ipMasked || "Unavailable",
    geo: geoFromRecord(record),
    device: deviceFromRecord(record),
    os: record.os || { name: null, version: null, status: "unavailable" },
    browser: record.browser || { name: null, version: null, status: "unavailable" },
    engine: record.engine || { name: null, version: null, status: "unavailable" },
    userAgent: record.userAgent || null,
    client: record.client || {},
    referrer: record.referrer || null,
    language: record.language || null,
    analytics: record.analytics || {}
  };
}

function adminSearchOptions(options, keyHex) {
  const search = typeof options?.search === "string" ? options.search.trim() : "";
  const ip = normalizeIP(search);
  if (!isIP(ip)) return options;
  const normalized = Buffer.from(ip);
  return {
    ...options,
    ipSearchHashes: [
      crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(normalized).digest("hex"),
      crypto.createHash("sha256").update(normalized).digest("hex")
    ]
  };
}

function createVisitorService({ repository, geoService, detectDevice, encryptionKey, logger = console, now = () => new Date() }) {
  const events = new EventEmitter();

  async function record(req, clientInput = {}) {
    const ip = getRequestIP(req);
    const userAgent = String(req.get("user-agent") || "Unknown").slice(0, 1000);
    const [geoResult, deviceResult] = await Promise.allSettled([
      Promise.resolve().then(() => geoService.lookup(ip)),
      Promise.resolve().then(() => detectDevice(userAgent))
    ]);
    const geo = geoResult.status === "fulfilled" ? geoResult.value : unavailableGeo("failed", "lookup_error");
    const deviceData = deviceResult.status === "fulfilled" ? deviceResult.value : {
      device: { category: "unknown", brand: null, model: null, status: "unavailable" },
      os: { name: null, version: null, status: "unavailable" },
      browser: { name: null, version: null, status: "unavailable" },
      engine: { name: null, version: null, status: "unavailable" }
    };
    if (geoResult.status === "rejected") logger.warn?.("visitor_geo_failed", { code: "lookup_error" });
    if (deviceResult.status === "rejected") logger.warn?.("visitor_device_failed", { code: "parser_error" });

    const normalizedIP = isIP(ip) ? normalizeIP(ip) : "";
    const ipHash = normalizedIP ? crypto.createHmac("sha256", Buffer.from(encryptionKey, "hex")).update(normalizedIP).digest("hex") : "";
    const legacyIpHash = normalizedIP ? crypto.createHash("sha256").update(normalizedIP).digest("hex") : "";
    const previousVisits = ipHash ? await repository.countByIpHash([ipHash, legacyIpHash]) : 0;
    const client = validateClientSignals(clientInput);
    const recordToSave = {
      ipEncrypted: normalizedIP ? encryptIP(normalizedIP, encryptionKey) : null,
      ipHash,
      ipMasked: normalizedIP ? maskIP(normalizedIP) : "Unavailable",
      geo: storedGeo(geo),
      geoStatus: { status: geo.status, precision: geo.precision, source: geo.source, errorCode: geo.errorCode },
      device: {
        type: deviceData.device.category,
        category: deviceData.device.category,
        vendor: deviceData.device.brand,
        brand: deviceData.device.brand,
        model: deviceData.device.model,
        status: deviceData.device.status
      },
      os: deviceData.os,
      browser: deviceData.browser,
      engine: deviceData.engine,
      userAgent,
      client,
      analytics: { returningVisitor: previousVisits > 0, previousVisits },
      createdAt: now()
    };
    const saved = await repository.insert(recordToSave);
    const result = {
      id: String(saved._id),
      ip: normalizedIP || "Unavailable",
      geo,
      device: deviceData.device,
      os: deviceData.os,
      browser: deviceData.browser,
      engine: deviceData.engine,
      client,
      userAgent,
      timestamp: saved.createdAt
    };
    events.emit("visitor", { id: result.id, timestamp: result.timestamp });
    return result;
  }

  return {
    record,
    history: async options => {
      const result = await repository.history(options);
      return { ...result, data: result.data.map(publicVisitor) };
    },
    adminHistory: async options => {
      const result = await repository.history(adminSearchOptions(options, encryptionKey));
      return { ...result, data: result.data.map(record => adminVisitor(record, encryptionKey)) };
    },
    adminDetail: async id => {
      const record = await repository.findById(id);
      return record ? adminVisitor(record, encryptionKey) : null;
    },
    subscribe: listener => {
      events.on("visitor", listener);
      return () => events.off("visitor", listener);
    },
    export: async options => {
      const result = await repository.history(adminSearchOptions({ ...options, page: 1, limit: 1000, maxLimit: 1000 }, encryptionKey));
      return result.data.map(record => adminVisitor(record, encryptionKey));
    }
  };
}

module.exports = { createVisitorService, decryptIP, deviceFromRecord, geoFromRecord, publicVisitor, adminSearchOptions };
