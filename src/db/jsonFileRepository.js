"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { constants } = require("node:fs");
const { emptyAnalytics, validateAnalytics, trimAnalytics, MAX_SESSION_EVENTS } = require("./analyticsSchema");

const FORMAT_VERSION = 2;
const LEGACY_FORMAT_VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateValue(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateState(state) {
  if (!isPlainObject(state) || ![LEGACY_FORMAT_VERSION, FORMAT_VERSION].includes(state.version) || !Array.isArray(state.records)) {
    throw new StorageError("STORAGE_FORMAT_INVALID", "Visitor storage has an unsupported or invalid format.");
  }
  if (state.records.length > 1_000_000) {
    throw new StorageError("STORAGE_FORMAT_INVALID", "Visitor storage exceeds the supported record count.");
  }
  const ids = new Set();
  for (const record of state.records) {
    if (!isPlainObject(record) || typeof record._id !== "string" || !record._id || record._id.length > 128 || !dateValue(record.createdAt)) {
      throw new StorageError("STORAGE_RECORD_INVALID", "Visitor storage contains an invalid record.");
    }
    if (Object.hasOwn(record, "ip")) {
      throw new StorageError("STORAGE_RECORD_INVALID", "Visitor storage contains a prohibited plaintext IP field.");
    }
    if (ids.has(record._id)) throw new StorageError("STORAGE_RECORD_INVALID", "Visitor storage contains duplicate record identifiers.");
    ids.add(record._id);
  }
  if (state.version === FORMAT_VERSION) {
    try { validateAnalytics(state.analytics); } catch {
      throw new StorageError("STORAGE_ANALYTICS_INVALID", "Visitor storage contains invalid analytics data.");
    }
  }
  return state;
}

function upgradeState(state) {
  validateState(state);
  if (state.version === FORMAT_VERSION) return state;
  return { version: FORMAT_VERSION, records: state.records, analytics: emptyAnalytics() };
}

function materialize(record) {
  return { ...record, createdAt: dateValue(record.createdAt) };
}

class JsonFileVisitorRepository {
  #filePath;
  #directory;
  #writeQueue = Promise.resolve();
  #lockPath;
  #lockToken;
  #closed = false;

  constructor(filePath) {
    this.#filePath = path.resolve(filePath);
    this.#directory = path.dirname(this.#filePath);
    this.#lockPath = `${this.#filePath}.lock`;
  }

  static async open(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new StorageError("STORAGE_CONFIG_INVALID", "A storage file path is required.");
    }
    const repository = new JsonFileVisitorRepository(filePath);
    await repository.#acquireLock();
    try {
      await repository.#initialize();
    } catch (error) {
      await repository.#releaseLock();
      throw error;
    }
    return repository;
  }

  async #acquireLock() {
    try {
      await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
      this.#lockToken = crypto.randomBytes(32).toString("hex");
      const handle = await fs.open(this.#lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, token: this.#lockToken }), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      this.#lockToken = null;
      if (error.code === "EEXIST") {
        throw new StorageError("STORAGE_ALREADY_IN_USE", "Visitor storage is already locked by another process; refusing concurrent access.");
      }
      throw new StorageError("STORAGE_LOCK_FAILED", "Visitor storage could not be locked safely.");
    }
  }

  async #releaseLock() {
    if (!this.#lockToken) return;
    try {
      const text = await fs.readFile(this.#lockPath, "utf8");
      const lock = JSON.parse(text);
      if (lock && lock.token === this.#lockToken) await fs.unlink(this.#lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new StorageError("STORAGE_LOCK_RELEASE_FAILED", "Visitor storage lock could not be released safely.");
      }
    } finally {
      this.#lockToken = null;
    }
  }

  #assertOpen() {
    if (this.#closed) throw new StorageError("STORAGE_CLOSED", "Visitor storage repository is closed.");
  }

  async #readState() {
    let handle;
    try {
      const noFollow = constants.O_NOFOLLOW || 0;
      handle = await fs.open(this.#filePath, constants.O_RDONLY | noFollow);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        throw new StorageError("STORAGE_FILE_INVALID", "Visitor storage file is not a supported regular file.");
      }
      const text = await handle.readFile({ encoding: "utf8" });
      let state;
      try {
        state = JSON.parse(text);
      } catch {
        throw new StorageError("STORAGE_CORRUPT", "Visitor storage is corrupt; it was left unchanged.");
      }
      return validateState(state);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (error.code === "ELOOP") throw new StorageError("STORAGE_FILE_INVALID", "Visitor storage file cannot be a symbolic link.");
      if (error.code === "ENOENT") throw error;
      throw new StorageError("STORAGE_READ_FAILED", "Visitor storage could not be read.");
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async #initialize() {
    try {
      await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
      let state = await this.#readState();
      let shouldWrite = false;
      if (state.version === LEGACY_FORMAT_VERSION) {
        state = upgradeState(state);
        shouldWrite = true;
      }
      const analyticsLengths = [state.analytics.requests.length, state.analytics.pages.length,
        state.analytics.security.length, state.analytics.sessions.length];
      trimAnalytics(state.analytics);
      const trimmedLengths = [state.analytics.requests.length, state.analytics.pages.length,
        state.analytics.security.length, state.analytics.sessions.length];
      shouldWrite ||= analyticsLengths.some((length, index) => length !== trimmedLengths[index]);
      if (shouldWrite) await this.#atomicWrite(state);
      return validateState(state);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.#atomicWrite({ version: FORMAT_VERSION, records: [], analytics: emptyAnalytics() });
    }
  }

  async #atomicWrite(state) {
    validateState(state);
    const payload = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(payload) > MAX_FILE_BYTES) {
      throw new StorageError("STORAGE_LIMIT", "Visitor storage reached its configured size limit.");
    }
    const temporaryPath = path.join(
      this.#directory,
      `.${path.basename(this.#filePath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
    );
    let handle;
    let renamed = false;
    try {
      handle = await fs.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporaryPath, this.#filePath);
      renamed = true;
      let directoryHandle;
      try {
        directoryHandle = await fs.open(this.#directory, constants.O_RDONLY);
        await directoryHandle.sync();
      } finally {
        await directoryHandle?.close().catch(() => {});
      }
    } catch {
      await handle?.close().catch(() => {});
      await fs.unlink(temporaryPath).catch(() => {});
      throw renamed
        ? new StorageError("STORAGE_DURABILITY_UNCONFIRMED", "Visitor storage was replaced but directory durability could not be confirmed.")
        : new StorageError("STORAGE_WRITE_FAILED", "Visitor storage could not be saved.");
    }
  }

  #mutate(operation) {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.catch(() => {});
    return result;
  }

  async insert(document) {
    this.#assertOpen();
    if (!isPlainObject(document) || Object.hasOwn(document, "ip")) {
      throw new StorageError("STORAGE_INPUT_INVALID", "Visitor record is invalid or contains prohibited plaintext IP data.");
    }
    let record;
    try {
      record = JSON.parse(JSON.stringify(document));
    } catch {
      throw new StorageError("STORAGE_INPUT_INVALID", "Visitor record is not valid JSON data.");
    }
    const createdAt = dateValue(document.createdAt);
    if (!createdAt) throw new StorageError("STORAGE_INPUT_INVALID", "Visitor record timestamp is invalid.");
    record._id = typeof record._id === "string" && record._id.length <= 128
      ? record._id
      : crypto.randomUUID();
    record.createdAt = createdAt.toISOString();
    return this.#mutate(async () => {
      const state = await this.#readState();
      if (state.records.some(existing => existing._id === record._id)) {
        throw new StorageError("STORAGE_DUPLICATE_ID", "Visitor record identifier already exists.");
      }
      state.records.push(record);
      await this.#atomicWrite(state);
      return materialize(record);
    });
  }

  async countByIpHash(hashes) {
    this.#assertOpen();
    const accepted = new Set((Array.isArray(hashes) ? hashes : [hashes]).filter(value => typeof value === "string"));
    const { records } = await this.#readState();
    return records.reduce((count, record) => count + (accepted.has(record.ipHash) ? 1 : 0), 0);
  }

  async distinctIpCount() {
    this.#assertOpen();
    const { records } = await this.#readState();
    return new Set(records.map(record => record.ipHash).filter(Boolean)).size;
  }

  async distinctIpCountSince(since) {
    this.#assertOpen();
    const threshold = dateValue(since);
    if (!threshold) throw new StorageError("STORAGE_INPUT_INVALID", "A valid visitor-count cutoff is required.");
    const { records } = await this.#readState();
    return new Set(records.filter(record => dateValue(record.createdAt).getTime() >= threshold.getTime()).map(record => record.ipHash).filter(Boolean)).size;
  }

  async returningVisitorCountSince(since) {
    this.#assertOpen();
    const threshold = dateValue(since);
    if (!threshold) throw new StorageError("STORAGE_INPUT_INVALID", "A valid visitor-count cutoff is required.");
    const { records } = await this.#readState();
    return records.filter(record => dateValue(record.createdAt).getTime() >= threshold.getTime() && record.analytics?.returningVisitor === true).length;
  }

  async history({ page = 1, limit = 50, maxLimit = 100, search = "", country = "", device = "", ipSearchHashes = [] } = {}) {
    this.#assertOpen();
    const safePage = Math.max(1, Math.min(10000, Number.parseInt(page, 10) || 1));
    const safeMax = Math.max(1, Math.min(1000, Number.parseInt(maxLimit, 10) || 100));
    const safeLimit = Math.max(1, Math.min(safeMax, Number.parseInt(limit, 10) || 50));
    const safeSearch = typeof search === "string" ? search.slice(0, 80) : "";
    const safeCountry = typeof country === "string" ? country.slice(0, 80) : "";
    const safeDevice = typeof device === "string" ? device.slice(0, 30) : "";
    const regex = safeSearch ? new RegExp(escapeRegex(safeSearch), "i") : null;
    const hashes = new Set(Array.isArray(ipSearchHashes)
      ? ipSearchHashes.filter(hash => typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash))
      : []);
    const { records } = await this.#readState();
    const matches = records.filter(record => {
      if (safeCountry && (record.geo?.country ?? record.country) !== safeCountry) return false;
      if (safeDevice && (record.device?.category ?? record.device?.type) !== safeDevice) return false;
      if (!regex) return true;
      const searchable = [record.ipMasked, record.geo?.city, record.geo?.region, record.geo?.country,
        record.city, record.region, record.country, record.device?.model, record.device?.vendor,
        record.browser?.name, record.os?.name];
      return searchable.some(value => value != null && regex.test(String(value))) || hashes.has(record.ipHash);
    });
    matches.sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt) || b._id.localeCompare(a._id));
    const total = matches.length;
    return {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
      data: matches.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(materialize)
    };
  }

  async findById(id) {
    this.#assertOpen();
    if (typeof id !== "string" || id.length > 128) return null;
    const { records } = await this.#readState();
    const record = records.find(item => item._id === id);
    return record ? materialize(record) : null;
  }

  async clearCreatedSince(cutoff) {
    this.#assertOpen();
    const threshold = dateValue(cutoff);
    if (!threshold) throw new StorageError("STORAGE_INPUT_INVALID", "A valid history cutoff is required.");
    return this.#mutate(async () => {
      const state = await this.#readState();
      const previousCount = state.records.length;
      state.records = state.records.filter(record => dateValue(record.createdAt).getTime() < threshold.getTime());
      const cut = threshold.getTime();
      state.analytics.requests = state.analytics.requests.filter(event => Date.parse(event.createdAt) < cut);
      state.analytics.pages = state.analytics.pages.filter(event => Date.parse(event.createdAt) < cut);
      state.analytics.security = state.analytics.security.filter(event => Date.parse(event.createdAt) < cut);
      state.analytics.sessions = state.analytics.sessions.filter(session => Date.parse(session.lastSeen) < cut);
      const deleted = previousCount - state.records.length;
      await this.#atomicWrite(state);
      return deleted;
    });
  }

  async clearAll() {
    this.#assertOpen();
    return this.#mutate(async () => {
      const state = await this.#readState();
      const deleted = state.records.length;
      state.records = [];
      state.analytics = emptyAnalytics();
      await this.#atomicWrite(state);
      return deleted;
    });
  }

  async overview(now = new Date()) {
    this.#assertOpen();
    const timestamp = now instanceof Date ? now.getTime() : Date.now();
    const last24 = timestamp - 24 * 60 * 60 * 1000;
    const last7 = timestamp - 7 * 24 * 60 * 60 * 1000;
    const { records } = await this.#readState();
    const recent = records.filter(record => dateValue(record.createdAt).getTime() >= last24);
    const grouped = (items, selector) => {
      const counts = new Map();
      for (const item of items) {
        const name = selector(item);
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
      return [...counts].map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
    };
    const country = record => record.geo?.country ?? record.country;
    const deviceType = record => record.device?.category ?? record.device?.type;
    const dailyCounts = new Map();
    for (const record of records) {
      const date = dateValue(record.createdAt);
      if (date.getTime() < last7) continue;
      const key = date.toISOString().slice(0, 10);
      dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
    }
    return {
      totalVisitors: records.length,
      last24h: recent.length,
      countries: grouped(recent, country),
      devices: grouped(recent, deviceType),
      browsers: grouped(recent, record => record.browser?.name),
      operatingSystems: grouped(recent, record => record.os?.name),
      daily: [...dailyCounts].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, count]) => ({ date, count }))
    };
  }

  async getAnalytics() {
    this.#assertOpen();
    return this.#mutate(async () => {
      const state = await this.#readState();
      const analyticsLengths = [state.analytics.requests.length, state.analytics.pages.length,
        state.analytics.security.length, state.analytics.sessions.length];
      trimAnalytics(state.analytics);
      const trimmedLengths = [state.analytics.requests.length, state.analytics.pages.length,
        state.analytics.security.length, state.analytics.sessions.length];
      const trimmed = analyticsLengths.some((length, index) => length !== trimmedLengths[index]);
      if (trimmed) await this.#atomicWrite(state);
      return JSON.parse(JSON.stringify(state.analytics));
    });
  }

  async saveAnalyticsBatch(events) {
    this.#assertOpen();
    if (!Array.isArray(events) || events.length > 1000) {
      throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics batch is invalid.");
    }
    const safeEvents = events.map(event => {
      if (!isPlainObject(event) || !["request", "page"].includes(event.type)) {
        throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics event is invalid.");
      }
      const method = String(event.method || "").toUpperCase();
      const createdAt = dateValue(event.createdAt);
      const sessionId = event.sessionId === null || event.sessionId === undefined ? null : String(event.sessionId);
      const pathName = typeof event.path === "string" ? event.path : "";
      if (!/^[A-Z]{1,16}$/.test(method) || !createdAt || !pathName.startsWith("/") || pathName.startsWith("//") || /[?#\r\n\\]/.test(pathName) || pathName.length > 180 ||
          (sessionId !== null && !/^[a-f0-9]{64}$/.test(sessionId))) {
        throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics event fields are invalid.");
      }
      const duration = event.type === "page" && event.duration == null ? null : Number(event.duration);
      if ((event.type === "request" && !Number.isFinite(duration)) ||
          (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > (event.type === "page" ? 3_600_000 : 600_000)))) {
        throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics duration is invalid.");
      }
      if (event.type === "request" && (!Number.isInteger(event.status) || event.status < 100 || event.status > 599)) {
        throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics response status is invalid.");
      }
      const securityType = event.securityType == null ? null : String(event.securityType);
      if (securityType && !["unauthorized", "forbidden", "not_found", "rate_limited", "suspicious_path", "unusual_method"].includes(securityType)) {
        throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Security event type is invalid.");
      }
      return { type: event.type, method, path: pathName, status: event.status, duration: Math.round(duration), createdAt: createdAt.toISOString(), sessionId, securityType };
    });
    return this.#mutate(async () => {
      const state = await this.#readState();
      const analytics = state.analytics;
      const now = Date.now();
      for (const event of safeEvents) {
        if (event.type === "request") analytics.requests.push({
          method: event.method, path: event.path, status: event.status, duration: event.duration,
          createdAt: event.createdAt, sessionId: event.sessionId, referrer: null
        });
        else analytics.pages.push({
          method: event.method, path: event.path, duration: event.duration,
          createdAt: event.createdAt, sessionId: event.sessionId, title: null, referrer: null
        });
        if (event.sessionId) {
          let session = analytics.sessions.find(item => item.sessionId === event.sessionId);
          if (!session) {
            session = { sessionId: event.sessionId, createdAt: event.createdAt, lastSeen: event.createdAt,
              updatedAt: event.createdAt, requestCount: 0, firstPath: event.path };
            analytics.sessions.push(session);
          }
          session.lastSeen = event.createdAt;
          session.updatedAt = event.createdAt;
          if (event.type === "request") session.requestCount = Math.min(Number.MAX_SAFE_INTEGER, session.requestCount + 1);
          if (event.type === "page" && event.path && !session.firstPath) session.firstPath = event.path;
        }
        const type = event.securityType || (event.type === "request" ? ({ 401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited" })[event.status] : null);
        if (type) analytics.security.push({ type, method: event.method, path: type === "suspicious_path" || type === "not_found" ? "/[redacted]" : event.path, createdAt: event.createdAt, sessionId: null });
      }
      trimAnalytics(analytics, now);
      return this.#atomicWrite(state);
    });
  }

  async analyticsSnapshot() {
    const analytics = await this.getAnalytics();
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;
    const lastHour = now - 60 * 60 * 1000;
    const recentRequests = analytics.requests.filter(event => Date.parse(event.createdAt) >= cutoff);
    const recentPages = analytics.pages.filter(event => Date.parse(event.createdAt) >= cutoff);
    const recentSecurity = analytics.security.filter(event => Date.parse(event.createdAt) >= cutoff);
    const statusCodes = new Map();
    const endpoints = new Map();
    for (const event of analytics.requests) {
      statusCodes.set(event.status, (statusCodes.get(event.status) || 0) + 1);
      const row = endpoints.get(event.path) || { path: event.path, count: 0 };
      row.count += 1;
      endpoints.set(event.path, row);
    }
    return {
      collectedFrom: analytics.collectedFrom,
      totalPageViews: analytics.pages.length,
      activeSessions: analytics.sessions.filter(session => now - Date.parse(session.lastSeen) <= 30 * 60 * 1000).length,
      lastHour: { requests: recentRequests.filter(event => Date.parse(event.createdAt) >= lastHour).length },
      last24h: { requests: recentRequests.length, pageViews: recentPages.length, sessions: analytics.sessions.filter(session => Date.parse(session.createdAt) >= cutoff).length, securityEvents: recentSecurity.length },
      runtime: { totalRequests: analytics.requests.length, errors: analytics.requests.filter(event => event.status >= 500).length,
        averageResponseMs: analytics.requests.length ? Math.round(analytics.requests.reduce((sum, event) => sum + event.duration, 0) / analytics.requests.length) : 0 },
      statusCodes: [...statusCodes].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      endpoints: [...endpoints.values()].sort((a, b) => b.count - a.count).slice(0, 20),
      requestEvents: analytics.requests.slice(-500).reverse(),
      pageRows: [...new Set(analytics.pages.map(event => event.path))].map(pathName => {
        const rows = analytics.pages.filter(event => event.path === pathName);
          const measured = rows.filter(event => Number.isFinite(event.duration));
          return { path: pathName, views: rows.length, averageDuration: measured.length ? Math.round(measured.reduce((sum, event) => sum + event.duration, 0) / measured.length) : null };
      }).sort((a, b) => b.views - a.views).slice(0, 50),
      sessions: analytics.sessions.slice().sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen)),
      securityEvents: analytics.security.slice(-200).reverse(),
      availability: { historical: false, collectedFrom: analytics.collectedFrom, retentionDays: 30,
        requestEventsCapped: analytics.requests.length >= 5000, pageEventsCapped: analytics.pages.length >= 2000,
        securityEventsCapped: analytics.security.length >= 1000 }
    };
  }

  async sessionAnalyticsDetail(sessionId) {
    if (typeof sessionId !== "string" || !/^[a-f0-9]{64}$/.test(sessionId)) return null;
    const analytics = await this.getAnalytics();
    const session = analytics.sessions.find(item => item.sessionId === sessionId);
    if (!session) return null;
    return {
      session: { ...session, ipHash: null, userAgent: null, referrer: null },
      pages: analytics.pages.filter(event => event.sessionId === sessionId).slice(-MAX_SESSION_EVENTS).map(event => ({ ...event, ipHash: null })),
      requests: analytics.requests.filter(event => event.sessionId === sessionId).slice(-MAX_SESSION_EVENTS).map(event => ({ ...event, referrer: null })),
      visitors: []
    };
  }

  async findVisitorsForSession(sessionId) {
    if (typeof sessionId !== "string" || !/^[a-f0-9]{64}$/.test(sessionId)) return [];
    const { records } = await this.#readState();
    return records.filter(record => record.analytics?.sessionId === sessionId)
      .sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt)).slice(0, 100).map(materialize);
  }

  async ping() {
    this.#assertOpen();
    await this.#readState();
    return true;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#writeQueue;
    await this.#releaseLock();
  }
}

module.exports = { JsonFileVisitorRepository, StorageError, FORMAT_VERSION, LEGACY_FORMAT_VERSION, MAX_FILE_BYTES, validateState, upgradeState };
