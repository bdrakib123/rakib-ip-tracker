"use strict";

const MAX_REQUEST_EVENTS = 5000;
const MAX_PAGE_EVENTS = 2000;
const MAX_SECURITY_EVENTS = 1000;
const MAX_SESSIONS = 1000;
const MAX_SESSION_EVENTS = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ANALYTICS_VERSION = 1;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyAnalytics(now = new Date()) {
  const collectedFrom = isoDate(now);
  if (!collectedFrom) throw new TypeError("Analytics collection timestamp is invalid.");
  return { version: ANALYTICS_VERSION, collectedFrom, requests: [], pages: [], security: [], sessions: [] };
}

function validateAnalytics(value) {
  if (!isObject(value) || value.version !== ANALYTICS_VERSION || !isoDate(value.collectedFrom) ||
      !Array.isArray(value.requests) || value.requests.length > MAX_REQUEST_EVENTS ||
      !Array.isArray(value.pages) || value.pages.length > MAX_PAGE_EVENTS ||
      !Array.isArray(value.security) || value.security.length > MAX_SECURITY_EVENTS ||
      !Array.isArray(value.sessions) || value.sessions.length > MAX_SESSIONS) {
    throw new TypeError("Analytics storage has an unsupported or invalid format.");
  }
  for (const event of [...value.requests, ...value.pages, ...value.security]) {
    if (!isObject(event) || !isoDate(event.createdAt) || typeof event.method !== "string" || event.method.length > 16 ||
        typeof event.path !== "string" || event.path.length > 180 || !event.path.startsWith("/") || event.path.startsWith("//") || /[?#\r\n\\]/.test(event.path) ||
        (event.sessionId !== null && (typeof event.sessionId !== "string" || !/^[a-f0-9]{64}$/.test(event.sessionId)))) {
      throw new TypeError("Analytics event is invalid.");
    }
  }
  for (const event of value.requests) {
    if (!Number.isInteger(event.status) || event.status < 100 || event.status > 599 ||
        !Number.isFinite(event.duration) || event.duration < 0 || event.duration > 600_000) {
      throw new TypeError("Request analytics event is invalid.");
    }
  }
  for (const event of value.pages) {
    if (event.duration !== null && (!Number.isFinite(event.duration) || event.duration < 0 || event.duration > 3_600_000)) {
      throw new TypeError("Page analytics event is invalid.");
    }
  }
  for (const event of value.security) {
    if (typeof event.type !== "string" || event.type.length > 40) throw new TypeError("Security analytics event is invalid.");
  }
  for (const session of value.sessions) {
    if (!isObject(session) || typeof session.sessionId !== "string" || !/^[a-f0-9]{64}$/.test(session.sessionId) ||
        !isoDate(session.createdAt) || !isoDate(session.lastSeen) || !isoDate(session.updatedAt) ||
        !Number.isSafeInteger(session.requestCount) || session.requestCount < 0 ||
        typeof session.firstPath !== "string" || session.firstPath.length > 180 || !session.firstPath.startsWith("/") || /[?#\r\n\\]/.test(session.firstPath)) {
      throw new TypeError("Analytics session is invalid.");
    }
  }
  return value;
}

function trimAnalytics(value, now = Date.now()) {
  const cutoff = now - RETENTION_MS;
  for (const key of ["requests", "pages", "security"]) {
    value[key] = value[key].filter(event => Date.parse(event.createdAt) >= cutoff);
  }
  value.sessions = value.sessions.filter(session => Date.parse(session.lastSeen) >= cutoff);
  value.requests = value.requests.slice(-MAX_REQUEST_EVENTS);
  value.pages = value.pages.slice(-MAX_PAGE_EVENTS);
  value.security = value.security.slice(-MAX_SECURITY_EVENTS);
  value.sessions.sort((a, b) => Date.parse(a.lastSeen) - Date.parse(b.lastSeen));
  value.sessions = value.sessions.slice(-MAX_SESSIONS);
  return value;
}

module.exports = {
  ANALYTICS_VERSION, MAX_REQUEST_EVENTS, MAX_PAGE_EVENTS, MAX_SECURITY_EVENTS,
  MAX_SESSIONS, MAX_SESSION_EVENTS, RETENTION_MS, emptyAnalytics, validateAnalytics, trimAnalytics
};
