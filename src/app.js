"use strict";

const path = require("node:path");
const express = require("express");
const { createAdminAuth, createStagingAccessGate, isSameOrigin } = require("./auth/adminAuth");
const { createRateLimiter } = require("./lib/rateLimit");
const { validateClientSignals } = require("./lib/validateClientSignals");
const { createLogger } = require("./lib/log");

function csvCell(value) {
  let clean = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(clean)) clean = `'${clean}`;
  return `"${clean.replaceAll('"', '""')}"`;
}

function createApp({ config, repository, visitorService, geoService, analytics, logger = createLogger(), now = Date.now, waitUntil = null }) {
  const app = express();
  const auth = createAdminAuth({ password: config.adminPassword, production: config.secureCookies ?? config.nodeEnv === "production", now,
    sessionStore: config.vercelMode ? repository : null });
  const sharedLimit = config.vercelMode ? { store: repository, keySecret: config.encryptionKey } : {};
  const publicLimiter = createRateLimiter({ windowMs: 60_000, max: config.publicRateLimit, now, bucketName: "public", ...sharedLimit });
  const historyLimiter = createRateLimiter({ windowMs: 60_000, max: config.publicRateLimit * 2, now, bucketName: "history", ...sharedLimit });
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: config.loginRateLimit, now, bucketName: "login", ...sharedLimit });
  const requestCounts = new Map();

  app.disable("x-powered-by");
  app.locals.closeAdminStreams = () => {};
  app.set("trust proxy", config.trustProxyHops);
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (config.secureCookies ?? config.nodeEnv === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    const route = `${req.method} ${req.path.replace(/\/[a-f0-9-]{16,}(?=\/|$)/gi, "/:id")}`.slice(0, 180);
    const sessionEligible = (req.method === "GET" && req.path === "/") ||
      req.path === "/api/public/intelligence" || req.path === "/api/track" || req.path === "/api/analytics/pageview";
    if (sessionEligible && typeof analytics.sessionFor === "function") {
      req.analyticsSessionId = analytics.sessionFor(req, res, config.secureCookies ?? config.nodeEnv === "production");
    }
    res.once("finish", () => {
      const row = requestCounts.get(route) || { count: 0, statuses: {} };
      row.count += 1;
      row.statuses[res.statusCode] = (row.statuses[res.statusCode] || 0) + 1;
      requestCounts.set(route, row);
      if (requestCounts.size > 300) requestCounts.delete(requestCounts.keys().next().value);
      const suspiciousPath = /(?:^|\/)(?:\.env|\.git|wp-admin|wp-login|phpmyadmin|xmlrpc\.php)(?:\/|$)/i.test(req.path);
      const staticAsset = /\.[a-z0-9]{1,8}$/i.test(req.path) && !suspiciousPath;
      const telemetryRead = req.path.startsWith("/api/admin/") || req.path.startsWith("/api/analytics/") || req.path.startsWith("/api/live") || req.path === "/api/server-health";
      const trackRequest = !staticAsset && req.path !== "/healthz" && !telemetryRead;
      const securityType = suspiciousPath ? "suspicious_path"
        : !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(req.method) ? "unusual_method"
        : ({ 401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited" })[res.statusCode] || null;
      if ((trackRequest || securityType) && typeof analytics.record === "function") {
        const routePath = req.route?.path ? `${req.baseUrl || ""}${req.route.path}` : (req.path === "/" ? "/" : "/[unmatched]");
        const eventTime = new Date().toISOString();
        const duration = Math.max(0, Math.min(600_000, Number(process.hrtime.bigint() - startedAt) / 1e6));
        const tracked = analytics.record({ type: "request", method: req.method, path: suspiciousPath || res.statusCode === 404 ? "/[redacted]" : routePath,
          status: res.statusCode, duration, createdAt: eventTime, sessionId: trackRequest ? req.analyticsSessionId || null : null, securityType });
        if (tracked && typeof tracked.then === "function") {
          const task = tracked.catch(error => logger.error?.("analytics_persist_failed", { code: typeof error?.code === "string" ? error.code : "DATABASE_OPERATION_FAILED" }));
          if (config.vercelMode && typeof waitUntil === "function") waitUntil(task);
        }
        if (req.method === "GET" && req.path === "/") {
          const pageEvent = analytics.record({ type: "page", method: "GET", path: "/", duration: null, createdAt: eventTime, sessionId: req.analyticsSessionId || null });
          if (pageEvent && typeof pageEvent.then === "function") {
            const task = pageEvent.catch(error => logger.error?.("analytics_persist_failed", { code: typeof error?.code === "string" ? error.code : "DATABASE_OPERATION_FAILED" }));
            if (config.vercelMode && typeof waitUntil === "function") waitUntil(task);
          }
        }
      }
    });
    next();
  });

  if (config.stagingMode) app.use(createStagingAccessGate(config.stagingAccessPassword));
  app.use((req, res, next) => {
    let limiter = null;
    if ((req.method === "POST" && ["/api/public/intelligence", "/api/track", "/api/analytics/pageview"].includes(req.path)) ||
        ((req.method === "GET" || req.method === "POST") && req.path === "/api/track")) limiter = publicLimiter;
    else if (req.method === "GET" && ["/api/public/history", "/api/history-preview", "/api/history", "/api/stats"].includes(req.path)) limiter = historyLimiter;
    else if (req.method === "POST" && ["/api/admin/auth/login", "/api/live/login"].includes(req.path)) limiter = loginLimiter;
    if (limiter) return limiter(req, res, next);
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));

  const requireAdmin = auth.requireAdmin;
  const adminWriteOrigin = (req, res, next) => {
    if (!isSameOrigin(req, { stagingHttps: config.stagingMode === true || config.vercelMode === true })) return res.status(403).json({ success: false, error: { code: "BAD_ORIGIN", message: "Request origin is not allowed." } });
    next();
  };
  const aggregateTelemetry = async () => {
    if (typeof analytics.snapshot === "function") {
      const snapshot = await analytics.snapshot();
      return { requests: snapshot.runtime.totalRequests, pageViews: snapshot.totalPageViews };
    }
    return { requests: [...requestCounts.values()].reduce((sum, row) => sum + row.count, 0), pageViews: 0 };
  };

  app.get("/healthz", async (_req, res) => {
    if (config.vercelMode) {
      try { await repository.ping(); } catch { return res.status(503).json({ success: false, status: "unavailable" }); }
    }
    res.json({ success: true, status: "ok" });
  });
  app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
  const sendAdmin = (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
  app.get("/admin", sendAdmin);
  app.get("/admin-panel", sendAdmin);
  app.use(express.static(path.join(__dirname, "..", "public"), { index: false, dotfiles: "ignore" }));

  app.post("/api/public/intelligence", async (req, res, next) => {
    try {
      const client = validateClientSignals(req.body?.client || {});
      const data = await visitorService.record(req, client);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/public/history", async (req, res, next) => {
    try {
      const result = await visitorService.history({
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search,
        country: req.query.country,
        device: req.query.device
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  const trackVisitor = async (req, res, next) => {
    try {
      const client = validateClientSignals(req.body?.client || {});
      const visitor = await visitorService.record(req, client);
      res.json({ success: true, visitor });
    } catch (error) { next(error); }
  };
  app.get("/api/track", trackVisitor);
  app.post("/api/track", trackVisitor);
  app.get("/api/history-preview", async (req, res, next) => {
    try {
      const result = await visitorService.history({ page: 1, limit: 10 });
      res.json({ success: true, locked: true, count: result.data.length, data: result.data });
    } catch (error) { next(error); }
  });
  app.get("/api/history", async (req, res, next) => {
    try {
      const result = await visitorService.history({ page: req.query.page, limit: req.query.limit, search: req.query.search, country: req.query.country, device: req.query.device });
      res.json({ success: true, locked: false, count: result.total, data: result.data });
    } catch (error) { next(error); }
  });
  app.get("/api/stats", async (_req, res, next) => {
    try {
      const overview = await analytics.overview();
      const uniqueIPs = await repository.distinctIpCount();
      res.json({ success: true, total: overview.totalVisitors, uniqueIPs, last24h: overview.last24h,
        countries: overview.countries.map(row => ({ country: row.name, count: row.count })),
        devices: overview.devices.map(row => ({ type: row.name, count: row.count })),
        security: { available: false, reason: "Security provider signals are not collected." }
      });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/auth/status", async (req, res, next) => {
    try { res.json({ success: true, data: { authenticated: await auth.isAuthenticated(req) } }); } catch (error) { next(error); }
  });
  app.post("/api/admin/auth/login", adminWriteOrigin, async (req, res, next) => {
    const candidate = typeof req.body?.password === "string" ? req.body.password.slice(0, 256) : "";
    if (!auth.authenticate(candidate)) return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Sign-in failed." } });
    try { await auth.setSession(res); res.json({ success: true }); } catch (error) { next(error); }
  });
  app.post("/api/live/login", adminWriteOrigin, async (req, res, next) => {
    const candidate = typeof req.body?.password === "string" ? req.body.password.slice(0, 256) : "";
    if (!auth.authenticate(candidate)) return res.status(401).json({ success: false, error: "INVALID_PASSWORD" });
    try { await auth.setSession(res); res.json({ success: true }); } catch (error) { next(error); }
  });
  app.post("/api/admin/auth/logout", adminWriteOrigin, async (req, res, next) => {
    try { await auth.clearSession(req, res); res.json({ success: true }); } catch (error) { next(error); }
  });
  app.post("/api/live/logout", adminWriteOrigin, async (req, res, next) => {
    try { await auth.clearSession(req, res); res.json({ success: true }); } catch (error) { next(error); }
  });
  app.get("/api/live/status", async (req, res, next) => {
    try { res.json({ success: true, authenticated: await auth.isAuthenticated(req) }); } catch (error) { next(error); }
  });

  app.get("/api/admin/history", requireAdmin, async (req, res, next) => {
    try {
      const result = await visitorService.adminHistory({
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search,
        country: req.query.country,
        device: req.query.device
      });
      if (req.query.contract === "v3") return res.json({ success: true, data: result });
      if (req.query.contract !== undefined && req.query.contract !== "legacy") return res.status(400).json({ success: false, error: "Unsupported history contract." });
      res.json({ success: true, count: result.data.length, data: result.data, page: result.page, limit: result.limit, total: result.total, pages: result.pages });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/history/:id", requireAdmin, async (req, res, next) => {
    try {
      const data = await visitorService.adminDetail(req.params.id);
      if (!data) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Visitor record not found." } });
      res.json({ success: true, data });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/analytics/overview", requireAdmin, async (_req, res, next) => {
    try { res.json({ success: true, data: await analytics.overview() }); } catch (error) { next(error); }
  });

  app.get("/api/analytics/overview", requireAdmin, async (_req, res, next) => {
    try { res.json({ success: true, ...await analytics.legacyOverview() }); } catch (error) { next(error); }
  });
  app.get("/api/analytics/requests", requireAdmin, async (req, res, next) => {
    try {
      const parsedLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) return res.status(400).json({ success: false, error: "Invalid limit; use an integer from 1 through 500." });
      const result = await analytics.requests(parsedLimit);
      res.json({ success: true, count: result.count, data: result.data,
        historicalDataAvailable: result.historicalDataAvailable, collectedFrom: result.collectedFrom,
        availability: result.availability });
    } catch (error) { next(error); }
  });
  app.post("/api/analytics/pageview", async (req, res, next) => {
    const candidate = typeof req.body?.path === "string" ? req.body.path.slice(0, 200) : "";
    if (!candidate.startsWith("/") || candidate.startsWith("//") || /[\r\n]/.test(candidate)) return res.status(400).json({ success: false, error: { code: "INVALID_PATH", message: "A local page path is required." } });
    const page = candidate.split(/[?#]/, 1)[0].replace(/\/{2,}/g, "/").slice(0, 180) || "/";
    const rawDuration = req.body?.duration === undefined ? null : Number(req.body.duration);
    if (rawDuration !== null && (!Number.isFinite(rawDuration) || rawDuration < 0 || rawDuration > 3_600_000)) return res.status(400).json({ success: false, error: "Invalid page duration." });
    try {
      await analytics.record?.({ type: "page", method: "POST", path: page, duration: rawDuration === null ? null : Math.round(rawDuration), createdAt: new Date().toISOString(), sessionId: req.analyticsSessionId || null });
      res.json({ success: true });
    } catch (error) { next(error); }
  });
  app.get("/api/analytics/pages", requireAdmin, async (_req, res, next) => {
    try { const result = await analytics.pages(); res.json({ success: true, pages: result.pages, data: result.pages,
      historicalDataAvailable: result.historicalDataAvailable, collectedFrom: result.collectedFrom,
      availability: result.availability }); } catch (error) { next(error); }
  });
  app.get("/api/analytics/sessions", requireAdmin, async (req, res, next) => {
    try {
      const parsedLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) return res.status(400).json({ success: false, error: "Invalid limit; use an integer from 1 through 500." });
      res.json({ success: true, ...await analytics.sessions(parsedLimit) });
    } catch (error) { next(error); }
  });
  app.get("/api/analytics/session/:sessionId", requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.params.sessionId || "");
      if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ success: false, error: "Invalid session ID." });
      const result = await analytics.sessionDetail(id);
      if (!result) return res.status(404).json({ success: false, error: "Session not found." });
      if (visitorService.adminSessionVisitors) result.visitors = await visitorService.adminSessionVisitors(id);
      res.json({ success: true, ...result });
    } catch (error) { next(error); }
  });
  app.get("/api/analytics/security", requireAdmin, async (_req, res, next) => {
    try { res.json({ success: true, ...await analytics.security() }); } catch (error) { next(error); }
  });

  app.get("/api/admin/provider/health", requireAdmin, (_req, res) => res.json({ success: true, data: analytics.providerHealth() }));
  app.get("/api/admin/server/health", requireAdmin, async (_req, res) => {
    let storage = "unavailable";
    try { await repository.ping(); storage = "available"; } catch {}
    const telemetry = await aggregateTelemetry();
    res.json({ success: true, data: {
      status: storage === "available" ? "healthy" : "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed },
      node: process.version,
      telemetry,
      storage,
      database: config.vercelMode ? storage : "not_configured",
      observedAt: new Date(now()).toISOString()
    } });
  });
  app.get("/api/server-health", requireAdmin, async (_req, res) => {
    let storage = "unavailable";
    try { await repository.ping(); storage = "available"; } catch {}
    const telemetry = await aggregateTelemetry();
    res.json({ success: true, status: storage === "available" ? "healthy" : "degraded", storage, uptimeSeconds: Math.floor(process.uptime()), memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed }, node: process.version, telemetry });
  });

  app.post("/api/admin/clear-data", requireAdmin, adminWriteOrigin, async (req, res, next) => {
    try {
      const type = req.body?.type;
      if (!["history", "everything", "24h", "7d"].includes(type)) return res.status(400).json({ success: false, error: { code: "INVALID_CLEAR_TYPE", message: "Choose 24h, 7d, or history." } });
      const clear = async () => {
        if (type === "history" || type === "everything") return repository.clearAll();
        if (type === "24h") return repository.clearCreatedSince(new Date(now() - 24 * 60 * 60 * 1000));
        return repository.clearCreatedSince(new Date(now() - 7 * 24 * 60 * 60 * 1000));
      };
      const deleted = analytics.withBarrier ? await analytics.withBarrier(clear) : await clear();
      res.json({ success: true, data: { type, deleted } });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/export", requireAdmin, async (req, res, next) => {
    try {
      if (req.query.format !== undefined && !["json", "csv"].includes(req.query.format)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_EXPORT_FORMAT", message: "Choose json or csv." } });
      }
      const records = await visitorService.export({ search: req.query.search, country: req.query.country, device: req.query.device });
      if (req.query.format === "csv") {
        const columns = ["ip", "maskedIP", "country", "region", "city", "device", "browser", "os", "timestamp"];
        const rows = records.map(item => ({
          ip: item.ip, maskedIP: item.maskedIP,
          country: item.geo.fields.country?.value,
          region: item.geo.fields.region?.value,
          city: item.geo.fields.city?.value,
          device: [item.device.brand, item.device.model, item.device.category].filter(Boolean).join(" "),
          browser: [item.browser.name, item.browser.version].filter(Boolean).join(" "),
          os: [item.os.name, item.os.version].filter(Boolean).join(" "), timestamp: item.timestamp
        }));
        res.type("text/csv").attachment("rakib-ip-history.csv").send([columns.map(csvCell).join(","), ...rows.map(row => columns.map(key => csvCell(row[key])).join(","))].join("\r\n"));
      } else {
        res.json({ success: true, data: records });
      }
    } catch (error) { next(error); }
  });

  const livePoll = (_req, res) => res.json({ success: true, data: { mode: "polling", intervalMs: 20_000, observedAt: new Date(now()).toISOString() } });
  app.get("/api/admin/live", requireAdmin, livePoll);
  app.get("/api/live", requireAdmin, livePoll);

  app.use((req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found." } }));
  app.use((error, req, res, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    logger.error("request_failed", { code: status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST", status, route: req.path });
    res.status(status).json({ success: false, error: {
      code: status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
      message: status === 500 ? "The request could not be completed." : "The request is invalid."
    } });
  });
  return app;
}

module.exports = { createApp };
