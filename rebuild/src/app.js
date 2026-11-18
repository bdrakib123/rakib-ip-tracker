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

function createApp({ config, repository, visitorService, geoService, analytics, logger = createLogger(), now = Date.now }) {
  const app = express();
  const auth = createAdminAuth({ password: config.adminPassword, production: config.secureCookies ?? config.nodeEnv === "production", now });
  const publicLimiter = createRateLimiter({ windowMs: 60_000, max: config.publicRateLimit, now });
  const historyLimiter = createRateLimiter({ windowMs: 60_000, max: config.publicRateLimit * 2, now });
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: config.loginRateLimit, now });
  const adminLiveClients = new Set();

  app.disable("x-powered-by");
  app.locals.closeAdminStreams = () => {
    for (const client of adminLiveClients) client.end();
  };
  app.set("trust proxy", config.trustProxyHops);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (config.secureCookies ?? config.nodeEnv === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  if (config.stagingMode) app.use(createStagingAccessGate(config.stagingAccessPassword));
  app.use(express.json({ limit: "16kb", strict: true }));

  const requireAdmin = auth.requireAdmin;
  const adminWriteOrigin = (req, res, next) => {
    if (!isSameOrigin(req, { stagingHttps: config.stagingMode === true })) return res.status(403).json({ success: false, error: { code: "BAD_ORIGIN", message: "Request origin is not allowed." } });
    next();
  };

  app.get("/healthz", (_req, res) => res.json({ success: true, status: "ok" }));
  app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
  app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html")));
  app.use(express.static(path.join(__dirname, "..", "public"), { index: false, dotfiles: "ignore" }));

  app.post("/api/public/intelligence", publicLimiter, async (req, res, next) => {
    try {
      const client = validateClientSignals(req.body?.client || {});
      const data = await visitorService.record(req, client);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/public/history", historyLimiter, async (req, res, next) => {
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

  app.get("/api/admin/auth/status", (req, res) => res.json({ success: true, data: { authenticated: auth.isAuthenticated(req) } }));
  app.post("/api/admin/auth/login", loginLimiter, adminWriteOrigin, (req, res) => {
    const candidate = typeof req.body?.password === "string" ? req.body.password.slice(0, 256) : "";
    if (!auth.authenticate(candidate)) return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Sign-in failed." } });
    auth.setSession(res);
    res.json({ success: true });
  });
  app.post("/api/admin/auth/logout", adminWriteOrigin, (req, res) => {
    auth.clearSession(req, res);
    res.json({ success: true });
  });

  app.get("/api/admin/history", requireAdmin, async (req, res, next) => {
    try {
      const data = await visitorService.adminHistory({
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search,
        country: req.query.country,
        device: req.query.device
      });
      res.json({ success: true, data });
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

  app.get("/api/admin/provider/health", requireAdmin, (_req, res) => res.json({ success: true, data: analytics.providerHealth() }));
  app.get("/api/admin/server/health", requireAdmin, async (_req, res) => {
    let storage = "unavailable";
    try { await repository.ping(); storage = "available"; } catch {}
    res.json({ success: true, data: {
      status: storage === "available" ? "healthy" : "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed },
      node: process.version,
      storage,
      database: "not_configured",
      observedAt: new Date(now()).toISOString()
    } });
  });

  app.get("/api/admin/export", requireAdmin, async (req, res, next) => {
    try {
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

  app.get("/api/admin/live", requireAdmin, (req, res) => {
    if (adminLiveClients.size >= 100) return res.status(503).end();
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    let closed = false;
    const send = payload => {
      if (closed) return;
      if (!auth.isAuthenticated(req)) {
        res.end();
        return;
      }
      res.write(`event: visitor\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const unsubscribe = visitorService.subscribe(send);
    adminLiveClients.add(res);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      adminLiveClients.delete(res);
    };
    const heartbeat = setInterval(() => {
      if (!auth.isAuthenticated(req)) {
        cleanup();
        res.end();
        return;
      }
      res.write(": heartbeat\n\n");
    }, 25_000);
    heartbeat.unref?.();
    req.on("close", cleanup);
    res.on("close", cleanup);
  });

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
