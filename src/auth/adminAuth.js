"use strict";

const crypto = require("node:crypto");

const COOKIE_NAME = "rakib_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STAGING_BASIC_USER = "rakib-staging";

function createStagingAccessGate(password) {
  const expected = crypto.createHash("sha256").update(`${STAGING_BASIC_USER}:${password}`, "utf8").digest();
  const failures = new Map();
  let checks = 0;
  return function requireStagingAccess(req, res, next) {
    if (req.method === "GET" && req.path === "/healthz") return next();
    const now = Date.now();
    checks += 1;
    if (checks % 256 === 0) {
      for (const [key, item] of failures) if (item.resetAt <= now) failures.delete(key);
    }
    const source = String(req.ip || req.socket?.remoteAddress || "unknown");
    const sourceKey = crypto.createHash("sha256").update(source).digest("hex");
    const existing = failures.get(sourceKey);
    if (existing && existing.resetAt <= now) failures.delete(sourceKey);
    else if (existing && existing.count >= 10) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((existing.resetAt - now) / 1000))));
      return res.status(429).type("text/plain").send("Too many staging authentication attempts.");
    }
    const header = req.get("authorization") || "";
    let accepted = false;
    const match = header.length <= 4096 && /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
    if (match) {
      try {
        const decoded = Buffer.from(match[1], "base64").toString("utf8");
        const separator = decoded.indexOf(":");
        if (separator >= 0) {
          const candidate = crypto.createHash("sha256").update(decoded, "utf8").digest();
          accepted = crypto.timingSafeEqual(candidate, expected) && decoded.slice(0, separator) === STAGING_BASIC_USER;
        }
      } catch {
        accepted = false;
      }
    }
    if (accepted) {
      failures.delete(sourceKey);
      return next();
    }
    if (failures.size >= 5000 && !failures.has(sourceKey)) failures.delete(failures.keys().next().value);
    const bucket = failures.get(sourceKey) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    bucket.count += 1;
    failures.set(sourceKey, bucket);
    res.setHeader("WWW-Authenticate", 'Basic realm="Rakib IP temporary staging", charset="UTF-8"');
    return res.status(401).type("text/plain").send("Staging access authentication required.");
  };
}

function constantTimePasswordCheck(candidate, configured) {
  const key = crypto.randomBytes(32);
  const actual = crypto.createHmac("sha256", key).update(String(candidate || "")).digest();
  const expected = crypto.createHmac("sha256", key).update(configured).digest();
  return crypto.timingSafeEqual(actual, expected);
}

function getCookie(req, name) {
  const prefix = `${name}=`;
  const value = String(req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(prefix));
  if (!value) return null;
  try { return decodeURIComponent(value.slice(prefix.length)); } catch { return null; }
}

function createAdminAuth({ password, production = false, now = Date.now, maxSessions = 1000, sessionStore = null }) {
  const sessions = new Map();
  const cookieOptions = `Path=/; HttpOnly; SameSite=Strict${production ? "; Secure" : ""}`;

  function cleanup() {
    const timestamp = now();
    for (const [token, expiresAt] of sessions) if (expiresAt <= timestamp) sessions.delete(token);
  }

  function authenticate(candidate) {
    return constantTimePasswordCheck(candidate, password);
  }

  function setSession(res) {
    cleanup();
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now() + SESSION_TTL_MS;
    const persist = sessionStore
      ? sessionStore.createAdminSession(crypto.createHash("sha256").update(token).digest("hex"), new Date(expiresAt))
      : (sessions.size >= maxSessions && sessions.delete(sessions.keys().next().value), sessions.set(token, expiresAt));
    const setCookie = () => res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    return persist && typeof persist.then === "function" ? persist.then(setCookie) : setCookie();
  }

  function clearSession(req, res) {
    const token = getCookie(req, COOKIE_NAME);
    const revoke = token && sessionStore
      ? sessionStore.revokeAdminSession(crypto.createHash("sha256").update(token).digest("hex"))
      : token ? sessions.delete(token) : null;
    const clearCookie = () => res.setHeader("Set-Cookie", `${COOKIE_NAME}=; ${cookieOptions}; Max-Age=0`);
    return revoke && typeof revoke.then === "function" ? revoke.then(clearCookie) : clearCookie();
  }

  function requireAdmin(req, res, next) {
    cleanup();
    const token = getCookie(req, COOKIE_NAME);
    const authenticated = token && sessionStore
      ? sessionStore.hasAdminSession(crypto.createHash("sha256").update(token).digest("hex"))
      : Boolean(token && sessions.has(token));
    const finish = allowed => {
      if (allowed) return next();
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Administrator sign-in is required." } });
    };
    return authenticated && typeof authenticated.then === "function"
      ? authenticated.then(finish).catch(next)
      : finish(authenticated);
  }

  function isAuthenticated(req) {
    cleanup();
    const token = getCookie(req, COOKIE_NAME);
    if (!token) return false;
    return sessionStore
      ? sessionStore.hasAdminSession(crypto.createHash("sha256").update(token).digest("hex"))
      : sessions.has(token);
  }

  return { authenticate, clearSession, isAuthenticated, requireAdmin, setSession };
}

function isSameOrigin(req, { stagingHttps = false } = {}) {
  const origin = req.get("origin");
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (stagingHttps) {
        const expectedHost = new URL(`https://${req.get("host")}`).host;
        return parsedOrigin.protocol === "https:" && parsedOrigin.host === expectedHost && !parsedOrigin.username && !parsedOrigin.password;
      }
      const expected = `${req.secure ? "https" : "http"}://${req.get("host")}`;
      return parsedOrigin.origin === expected;
    } catch { return false; }
  }
  return req.get("sec-fetch-site") === "same-origin";
}

module.exports = { createAdminAuth, createStagingAccessGate, isSameOrigin };
