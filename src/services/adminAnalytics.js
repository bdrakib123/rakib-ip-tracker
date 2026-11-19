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
  let deferred = [];
  let timer = null;
  let flushing = null;
  let persistentPending = [];
  let persistentDeferred = [];
  let persistentFlushing = null;
  let persistentOutstanding = 0;
  let persistentFailureCount = 0;
  let lastPersistentFailure = null;
  let jsonInFlight = 0;
  let closed = false;
  let paused = false;
  let activeBarrier = null;
  let droppedPendingEvents = 0;
  let lastPersistenceError = null;
  const ready = repository.getAnalytics ? repository.getAnalytics().then(() => true) : Promise.resolve(true);

  function boundPending() {
    while (pending.length + deferred.length + jsonInFlight > MAX_PENDING_EVENTS) {
      if (deferred.length) deferred.shift();
      else pending.shift();
      droppedPendingEvents += 1;
      lastPersistenceError = "ANALYTICS_QUEUE_FULL";
    }
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
    if (closed || paused || timer || !repository.saveAnalyticsBatch || repository.persistent === true) return;
    timer = setTimeout(() => {
      timer = null;
      if (paused) return;
      flushJson().catch(() => scheduleFlush());
    }, flushDelayMs);
    timer.unref?.();
  }

  function schedulePersistentFlush() {
    if (closed || paused || timer || repository.persistent !== true || !persistentPending.length) return;
    timer = setTimeout(() => {
      timer = null;
      startPersistentFlush().catch(() => {});
    }, flushDelayMs);
    timer.unref?.();
  }

  function startPersistentFlush(force = false) {
    if (persistentFlushing) return persistentFlushing;
    if (paused && !force || !persistentPending.length) return Promise.resolve();
    const current = (async () => {
      await ready;
      while (persistentPending.length && (force || !paused)) {
        const batch = persistentPending.splice(0, 250);
        try {
          await repository.saveAnalyticsBatch(batch.map(item => item.event));
          lastPersistenceError = null;
          for (const item of batch) item.resolve();
        } catch (error) {
          lastPersistentFailure = error;
          persistentFailureCount += 1;
          lastPersistenceError = typeof error?.code === "string" ? error.code : "STORAGE_ERROR";
          for (const item of batch) item.reject(error);
          throw error;
        } finally {
          persistentOutstanding -= batch.length;
        }
      }
    })();
    persistentFlushing = current;
    current.finally(() => {
      if (persistentFlushing === current) persistentFlushing = null;
      if (persistentPending.length) schedulePersistentFlush();
    }).catch(() => {});
    return current;
  }

  async function flushPersistent(force = false) {
    await ready;
    while (true) {
      if (persistentFlushing) {
        await persistentFlushing;
        continue;
      }
      if (!persistentPending.length || paused && !force) return;
      await startPersistentFlush(force);
    }
  }

  async function flushJson(force = false) {
    await ready;
    if (paused && !force) return;
    if (flushing) {
      await flushing;
      if (force && pending.length) return flushJson(true);
      return;
    }
    clearTimeout(timer);
    timer = null;
    flushing = (async () => {
      while (pending.length) {
        const batch = pending.splice(0, 500);
        jsonInFlight = batch.length;
        try {
          await repository.saveAnalyticsBatch(batch);
          lastPersistenceError = null;
        } catch (error) {
          pending = batch.concat(pending);
          lastPersistenceError = typeof error?.code === "string" ? error.code : "STORAGE_ERROR";
          throw error;
        } finally {
          jsonInFlight = 0;
          boundPending();
        }
      }
    })();
    try { await flushing; }
    finally {
      flushing = null;
      if (pending.length && !closed && !paused) scheduleFlush();
    }
  }

  async function flush(force = false) {
    if (repository.persistent === true) return flushPersistent(force);
    return flushJson(force);
  }

  function record(event) {
    if (!repository.saveAnalyticsBatch || closed) return;
    if (repository.persistent === true) {
      if (persistentOutstanding >= MAX_PENDING_EVENTS) {
        droppedPendingEvents += 1;
        lastPersistenceError = "ANALYTICS_QUEUE_FULL";
        const error = new Error("Analytics persistence queue is full.");
        error.code = "ANALYTICS_QUEUE_FULL";
        return Promise.reject(error);
      }
      persistentOutstanding += 1;
      const promise = new Promise((resolve, reject) => {
        const item = { event, resolve, reject };
        (paused ? persistentDeferred : persistentPending).push(item);
      });
      if (!paused) startPersistentFlush().catch(() => {});
      return promise;
    }
    if (pending.length + deferred.length + jsonInFlight >= MAX_PENDING_EVENTS && paused) {
      droppedPendingEvents += 1;
      lastPersistenceError = "ANALYTICS_QUEUE_FULL";
      return;
    }
    (paused ? deferred : pending).push(event);
    boundPending();
    if (pending.length >= 500) {
      clearTimeout(timer);
      timer = null;
      flushJson().catch(() => scheduleFlush());
    } else scheduleFlush();
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

  function withBarrier(operation) {
    if (closed) return Promise.reject(Object.assign(new Error("Analytics service is closed."), { code: "ANALYTICS_CLOSED" }));
    if (activeBarrier) return Promise.reject(Object.assign(new Error("An analytics barrier is already active."), { code: "ANALYTICS_BARRIER_ACTIVE", status: 409 }));
    paused = true;
    let release;
    const barrierDone = new Promise(resolve => { release = resolve; });
    activeBarrier = barrierDone;
    const failuresAtStart = persistentFailureCount;
    return (async () => {
      try {
        await flush(true);
        if (persistentFailureCount > failuresAtStart) throw lastPersistentFailure;
        return await operation();
      } finally {
        paused = false;
        if (repository.persistent === true) {
          persistentPending.push(...persistentDeferred);
          persistentDeferred = [];
        } else {
          pending.push(...deferred);
          deferred = [];
          boundPending();
        }
        activeBarrier = null;
        release();
        if (repository.persistent === true) startPersistentFlush().catch(() => {});
        else if (pending.length) scheduleFlush();
      }
    })();
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
      if (activeBarrier) await activeBarrier;
      try {
        await flush(true);
      } catch (error) {
        if (repository.persistent === true && persistentPending.length) {
          lastPersistentFailure = error;
          lastPersistenceError = typeof error?.code === "string" ? error.code : "STORAGE_ERROR";
          for (const item of persistentPending.splice(0)) {
            persistentOutstanding -= 1;
            item.reject(error);
          }
        }
        throw error;
      }
    }
  };
}

module.exports = { COOKIE_NAME, SESSION_IDLE_MS, createAdminAnalytics };
