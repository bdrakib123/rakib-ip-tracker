"use strict";

const crypto = require("node:crypto");

const COOKIE_NAME = "rakib_analytics";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const FLUSH_DELAY_MS = 750;
const MAX_PENDING_EVENTS = 5000;

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const item = String(req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(prefix));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return null; }
}

function createAdminAnalytics({ repository, geoService, encryptionKey, now = Date.now, flushDelayMs = FLUSH_DELAY_MS }) {
  let pending = [];
  let timer = null;
  let flushing = null;
  let closed = false;
  let paused = false;
  let droppedPendingEvents = 0;
  let lastPersistenceError = null;
  const ready = repository.getAnalytics ? repository.getAnalytics().then(() => true) : Promise.resolve(true);

  function boundPending() {
    if (pending.length <= MAX_PENDING_EVENTS) return;
    const overflow = pending.length - MAX_PENDING_EVENTS;
    pending.splice(0, overflow);
    droppedPendingEvents += overflow;
  }

  function sessionFor(req, res, secureCookie = req.secure) {
    let token = cookieValue(req, COOKIE_NAME);
    if (!token || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
      token = crypto.randomBytes(32).toString("base64url");
      const secure = secureCookie ? "; Secure" : "";
      res.append("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${secure}`);
    }
    return crypto.createHmac("sha256", Buffer.from(encryptionKey, "hex")).update("rakib-analytics-session:").update(token).digest("hex");
  }

  function scheduleFlush() {
    if (closed || paused || timer || !repository.saveAnalyticsBatch) return;
    timer = setTimeout(() => {
      timer = null;
      if (paused) return;
      flush().catch(() => scheduleFlush());
    }, flushDelayMs);
    timer.unref?.();
  }

  function record(event) {
    if (!repository.saveAnalyticsBatch || closed) return;
    pending.push(event);
    boundPending();
    if (pending.length >= 500) {
      clearTimeout(timer);
      timer = null;
      flush().catch(() => scheduleFlush());
    } else scheduleFlush();
  }

  async function flush() {
    await ready;
    if (paused) return;
    if (flushing) return flushing;
    clearTimeout(timer);
    timer = null;
    flushing = (async () => {
      while (pending.length) {
        const batch = pending.splice(0, 500);
        try {
          await repository.saveAnalyticsBatch(batch);
          lastPersistenceError = null;
        } catch (error) {
          pending = batch.concat(pending);
          boundPending();
          lastPersistenceError = typeof error?.code === "string" ? error.code : "STORAGE_ERROR";
          throw error;
        }
      }
    })();
    try { await flushing; } finally { flushing = null; if (pending.length) scheduleFlush(); }
  }

  async function snapshot() {
    await flush();
    const current = repository.analyticsSnapshot ? await repository.analyticsSnapshot() : {
      activeSessions: 0, lastHour: { requests: 0 }, last24h: { requests: 0, pageViews: 0, sessions: 0, securityEvents: 0 },
      runtime: { totalRequests: 0, errors: 0, averageResponseMs: 0 }, statusCodes: [], endpoints: [],
      requestEvents: [], pageRows: [], sessions: [], securityEvents: [], availability: { historical: false, collectedFrom: null, retentionDays: 30 }
    };
    return { ...current, availability: { ...current.availability, pendingDroppedEvents: droppedPendingEvents, persistenceError: lastPersistenceError } };
  }

  async function withBarrier(operation) {
    await flush();
    paused = true;
    try { return await operation(); }
    finally { paused = false; if (pending.length) scheduleFlush(); }
  }

  async function legacyOverview() {
    const cutoff = new Date(now() - 24 * 60 * 60 * 1000);
    const [visitors, events, uniqueVisitors, returningVisitors] = await Promise.all([
      repository.overview(),
      snapshot(),
      repository.distinctIpCountSince?.(cutoff) ?? repository.distinctIpCount(),
      repository.returningVisitorCountSince?.(cutoff) ?? Promise.resolve(null)
    ]);
    return {
      ...events,
      last24h: { ...events.last24h, uniqueVisitors, returningVisitors },
      visitors,
      availability: { ...events.availability, returningVisitors: returningVisitors !== null, historicalEventsBefore: events.availability.collectedFrom }
    };
  }

  return {
    ready,
    overview: () => repository.overview(),
    legacyOverview,
    providerHealth: () => geoService.health(),
    sessionFor,
    record,
    snapshot,
    requests: async limit => {
      const current = await snapshot();
      const data = current.requestEvents.slice(0, limit);
      return { count: data.length, data: data.map(event => ({ ...event, referrer: null })), historicalDataAvailable: false, collectedFrom: current.collectedFrom, availability: current.availability };
    },
    pages: async () => {
      const current = await snapshot();
      return { pages: current.pageRows.map(row => ({ ...row, averageDuration: row.averageDuration ?? null })), historicalDataAvailable: false, collectedFrom: current.collectedFrom, availability: current.availability };
    },
    sessions: async limit => {
      const current = await snapshot();
      const data = current.sessions.slice(0, limit).map(session => ({
        ...session, ipHash: null, userAgent: null, referrer: null
      }));
      return { active: current.activeSessions, count: data.length, data, historicalDataAvailable: false, collectedFrom: current.collectedFrom, availability: current.availability };
    },
    sessionDetail: async id => {
      if (!repository.sessionAnalyticsDetail) return null;
      const [detail, stored] = await Promise.all([repository.sessionAnalyticsDetail(id), repository.getAnalytics()]);
      return detail ? { ...detail, historicalDataAvailable: false, collectedFrom: stored.collectedFrom } : null;
    },
    security: async () => {
      const current = await snapshot();
      const data = current.securityEvents;
      return { count: data.length, data: data.map(({ type, method, path, createdAt }) => ({ type, method, path, createdAt, sessionId: null })), historicalDataAvailable: false, collectedFrom: current.collectedFrom, availability: current.availability };
    },
    withBarrier,
    close: async () => {
      closed = true;
      clearTimeout(timer);
      timer = null;
      await flush();
    }
  };
}

module.exports = { COOKIE_NAME, SESSION_IDLE_MS, createAdminAnalytics };
