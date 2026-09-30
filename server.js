require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { performance } = require("perf_hooks");
const { MongoClient } = require("mongodb");
const UAParser = require("ua-parser-js");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "goatbot";
const LIVE_PASSWORD = process.env.LIVE_PASSWORD || "rakib69";

const MAX_HISTORY = 10000;
const PREVIEW_LIMIT = 10;
const SESSION_TTL = 1000 * 60 * 60 * 12;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing");
  process.exit(1);
}

if (
  !process.env.IP_ENCRYPTION_KEY ||
  !/^[0-9a-fA-F]{64}$/.test(process.env.IP_ENCRYPTION_KEY)
) {
  console.error(
    "❌ IP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters"
  );
  process.exit(1);
}

const ENCRYPTION_KEY = Buffer.from(
  process.env.IP_ENCRYPTION_KEY,
  "hex"
);

const SESSION_SECRET = process.env.LIVE_SESSION_SECRET || crypto.randomBytes(32).toString("hex");

let mongoClient;
let db;
let visitorsCollection;

let sessionsCollection;
let pageViewsCollection;
let requestsCollection;
let securityCollection;

const liveClients = new Set();

/* =========================================================
   SERVER ANALYTICS STATE
========================================================= */

const analyticsState = {
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  statusCodes: new Map(),
  endpoints: new Map(),
  totalResponseTime: 0,
  lastRequestAt: null
};

const activeSessions = new Map();
const SESSION_COOKIE = "rakib_sid";
const SESSION_MAX_AGE = 1000 * 60 * 30;

/* =========================================================
   EXPRESS
========================================================= */

app.disable("x-powered-by");
app.set("trust proxy", true);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

/* =========================================================
   REQUEST ANALYTICS MIDDLEWARE
========================================================= */

function getSessionId(req, res) {
  const existing = String(
    req.headers.cookie || ""
  )
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(`${SESSION_COOKIE}=`));

  if (existing) {
    return decodeURIComponent(existing.split("=")[1] || "");
  }

  const sessionId = crypto.randomBytes(18).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax`
  );

  return sessionId;
}

function cleanPath(value) {
  const raw = String(value || "/").split("?")[0];
  return raw.length > 180 ? raw.slice(0, 180) : raw;
}

function recordMapIncrement(map, key, amount = 1) {
  const current = Number(map.get(key) || 0);
  map.set(key, current + amount);

  if (map.size > 300) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

app.use((req, res, next) => {
  const started = performance.now();

  const sessionId = getSessionId(req, res);

  req.rakibAnalytics = {
    sessionId
  };

  /*
   * Session is touched here because this middleware runs
   * before all API routes.
   */
  if (
    typeof touchAnalyticsSession === "function" &&
    !req.path.startsWith("/api/live")
  ) {
    touchAnalyticsSession(req).catch(error => {
      console.error("session touch:", error.message);
    });
  }

  res.on("finish", () => {
    const duration = Math.max(
      0,
      Math.round(performance.now() - started)
    );

    const pathName = cleanPath(req.originalUrl || req.path);
    const status = Number(res.statusCode || 200);

    analyticsState.requests += 1;
    analyticsState.totalResponseTime += duration;
    analyticsState.lastRequestAt = new Date();

    recordMapIncrement(
      analyticsState.statusCodes,
      String(status)
    );

    recordMapIncrement(
      analyticsState.endpoints,
      pathName
    );

    if (status >= 400) {
      analyticsState.errors += 1;
    }

    /*
     * Lightweight security telemetry.
     * This does NOT classify a visitor as malicious.
     */
    const suspiciousPath =
      /(?:\.env|\.git|wp-admin|wp-login|phpmyadmin|xmlrpc\.php|config\.php|\.well-known\/.*\.php)/i
        .test(pathName);

    const suspiciousMethod =
      !["GET", "POST", "HEAD", "OPTIONS"].includes(req.method);

    const securityType =
      status === 404
        ? "not_found"
        : status === 401
          ? "unauthorized"
          : status === 403
            ? "forbidden"
            : status === 429
              ? "rate_limited"
              : suspiciousPath
                ? "suspicious_path"
                : suspiciousMethod
                  ? "unusual_method"
                  : null;

    if (
      securityType &&
      typeof logSecurityEvent === "function"
    ) {
      logSecurityEvent(req, securityType, {
        status,
        duration,
        path: pathName
      }).catch(() => {});
    }

    const ip = getClientIP(req);

    const isStaticAsset =
      /\.(?:css|js|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|map)$/i
        .test(pathName);

    if (
      requestsCollection &&
      !pathName.startsWith("/api/live") &&
      !isStaticAsset
    ) {
      requestsCollection.insertOne({
        sessionId,
        ipHash: hashIP(ip),
        path: pathName,
        method: req.method,
        status,
        duration,
        userAgent: String(
          req.headers["user-agent"] || ""
        ).slice(0, 500),
        referrer: String(
          req.headers.referer || ""
        ).slice(0, 500),
        createdAt: new Date()
      }).catch(error => {
        console.error("request analytics:", error.message);
      });
    }
  });

  next();
});

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   HELPERS
========================================================= */

function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    const first = String(forwarded).split(",")[0].trim();

    if (first) {
      return normalizeIP(first);
    }
  }

  return normalizeIP(
    req.ip ||
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress ||
      ""
  );
}

function normalizeIP(ip) {
  ip = String(ip || "").trim();

  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }

  if (ip === "::1") {
    return "127.0.0.1";
  }

  return ip;
}


/* =========================================================
 * SECURITY RISK SIGNAL
 * ========================================================= */

function calculateRiskScore(visitor) {
  const security = visitor?.geo?.security || {};
  let score = 0;
  const reasons = [];

  if (security.vpn) {
    score += 20;
    reasons.push("VPN");
  }

  if (security.proxy) {
    score += 25;
    reasons.push("Proxy");
  }

  if (security.tor) {
    score += 35;
    reasons.push("Tor");
  }

  if (security.hosting) {
    score += 20;
    reasons.push("Hosting");
  }

  score = Math.min(100, score);

  let level = "LOW";

  if (score >= 70) {
    level = "HIGH";
  } else if (score >= 35) {
    level = "MEDIUM";
  }

  return {
    score,
    level,
    reasons
  };
}

function maskIP(ip) {
  ip = normalizeIP(ip);

  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);

    if (parts.length > 2) {
      return parts.slice(0, 3).join(":") + ":xxxx";
    }

    return "xxxx:xxxx";
  }

  const parts = ip.split(".");

  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  }

  return "xxx.xxx.xxx.xxx";
}

function hashIP(ip) {
  return crypto
    .createHash("sha256")
    .update(normalizeIP(ip))
    .digest("hex");
}

/* =========================================================
   IP ENCRYPTION
========================================================= */

function encryptIP(ip) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(ip, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  };
}

function decryptIP(payload) {
  if (!payload) return null;

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      ENCRYPTION_KEY,
      Buffer.from(payload.iv, "base64")
    );

    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/* =========================================================
   PASSWORD / SESSION
========================================================= */

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

function createSessionToken() {
  const expires = Date.now() + SESSION_TTL;

  const payload = String(expires);

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");

  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token) return false;

  const parts = String(token).split(".");

  if (parts.length !== 2) return false;

  const [expires, signature] = parts;

  if (!/^\d+$/.test(expires)) {
    return false;
  }

  if (Number(expires) < Date.now()) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(expires)
    .digest("hex");

  return safeEqual(signature, expected);
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");

    if (index === -1) continue;

    const key = cookie.slice(0, index).trim();
    const value = cookie.slice(index + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function requireAdmin(req, res, next) {
  const token = getCookie(req, "rakib_live");

  if (!verifySessionToken(token)) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED"
    });
  }

  next();
}

/* =========================================================
   GEOLOCATION
========================================================= */

async function getGeoData(ip) {
  if (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.16.")
  ) {
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

  try {
    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`
    );

    const data = await response.json();

    if (!data || data.success === false) {
      throw new Error("Geo lookup failed");
    }

    return {
      country: data.country || "Unknown",
      countryCode: data.country_code || "",
      region: data.region || "Unknown",
      city: data.city || "Unknown",
      postal: data.postal || "",
      timezone:
        data.timezone?.id ||
        data.timezone?.utc ||
        "",
      isp: data.connection?.isp || "Unknown",
      organization:
        data.connection?.org ||
        data.connection?.isp ||
        "Unknown",
      asn: data.connection?.asn
        ? `AS${data.connection.asn}`
        : "Unknown",
      latitude:
        typeof data.latitude === "number"
          ? data.latitude
          : null,
      longitude:
        typeof data.longitude === "number"
          ? data.longitude
          : null,

      security: {
        vpn: !!data.security?.vpn,
        proxy: !!data.security?.proxy,
        tor: !!data.security?.tor,
        hosting: !!data.security?.hosting,
        source: "ipwho.is"
      }
    };
  } catch (error) {
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
}

/* =========================================================
   USER AGENT
========================================================= */

function parseUserAgent(userAgent) {
  const parser = new UAParser(userAgent);

  const result = parser.getResult();

  return {
    device: {
      type: result.device?.type || "desktop",
      vendor: result.device?.vendor || "Unknown",
      model: result.device?.model || "Unknown"
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

    userAgent
  };
}

/* =========================================================
   DATABASE
========================================================= */

async function connectMongo() {
  mongoClient = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000
  });

  await mongoClient.connect();

  db = mongoClient.db(MONGODB_DB);

  visitorsCollection = db.collection("ip_tracker_visitors");

  sessionsCollection = db.collection("ip_tracker_sessions");
  pageViewsCollection = db.collection("ip_tracker_pageviews");
  requestsCollection = db.collection("ip_tracker_requests");
  securityCollection = db.collection("ip_tracker_security");

  await visitorsCollection.createIndex({
    createdAt: -1
  });

  await sessionsCollection.createIndex({
    createdAt: -1
  });

  await sessionsCollection.createIndex({
    sessionId: 1
  });

  await sessionsCollection.createIndex({
    ipHash: 1
  });

  await pageViewsCollection.createIndex({
    createdAt: -1
  });

  await pageViewsCollection.createIndex({
    sessionId: 1,
    createdAt: -1
  });

  await pageViewsCollection.createIndex({
    path: 1
  });

  await requestsCollection.createIndex({
    createdAt: -1
  });

  await requestsCollection.createIndex({
    ipHash: 1,
    createdAt: -1
  });

  await requestsCollection.createIndex({
    path: 1,
    createdAt: -1
  });

  await securityCollection.createIndex({
    createdAt: -1
  });

  await securityCollection.createIndex({
    ipHash: 1,
    createdAt: -1
  });

  await visitorsCollection.createIndex({
    ipHash: 1
  });

  await visitorsCollection.createIndex({
    "geo.countryCode": 1
  });

  await visitorsCollection.createIndex({
    "device.type": 1
  });

  console.log("✅ MongoDB connected");
}

/* =========================================================
   RECORD VISITOR
========================================================= */

async function createVisitor(req, clientData = {}) {
  const ip = getClientIP(req);
  const userAgent = req.headers["user-agent"] || "Unknown";

  const ua = parseUserAgent(userAgent);
  const geo = await getGeoData(ip);

  const sessionId =
    req.rakibAnalytics?.sessionId || "";

  let previousVisits = 0;

  try {
    previousVisits =
      await visitorsCollection.countDocuments({
        ipHash: hashIP(ip)
      });
  } catch {}

  const visitor = {
    sessionId,

    ipEncrypted: encryptIP(ip),
    ipHash: hashIP(ip),
    ipMasked: maskIP(ip),

    geo,

    device: ua.device,
    os: ua.os,
    browser: ua.browser,
    engine: ua.engine,
    userAgent: ua.userAgent,

    referrer: req.headers.referer || "",
    language: req.headers["accept-language"] || "",

    analytics: {
      sessionId,
      returningVisitor: previousVisits > 0,
      previousVisits
    },

    client: {
      screen: clientData.screen || {},
      viewport: clientData.viewport || {},
      pixelRatio: clientData.pixelRatio ?? null,
      colorDepth: clientData.colorDepth ?? null,
      touchPoints: clientData.touchPoints ?? null,
      touchSupport: !!clientData.touchSupport,
      hardwareConcurrency: clientData.hardwareConcurrency ?? null,
      deviceMemory: clientData.deviceMemory ?? null,
      language: clientData.language || "",
      languages: Array.isArray(clientData.languages)
        ? clientData.languages.slice(0, 20)
        : [],
      timezone: clientData.timezone || "",
      timezoneOffset: clientData.timezoneOffset ?? null,
      cookiesEnabled: !!clientData.cookiesEnabled,
      doNotTrack: clientData.doNotTrack || "",
      online: clientData.online !== false,
      connection: clientData.connection || {},
      webgl: clientData.webgl || {},
      canvasHash: clientData.canvasHash || "",
      platform: clientData.platform || ""
    },

    createdAt: new Date()
  };

  const result = await visitorsCollection.insertOne(visitor);

  visitor._id = result.insertedId;

  await trimHistory();

  return visitor;
}

/* =========================================================
   TRIM OLD DATA
========================================================= */

async function trimHistory() {
  try {
    const oldRecords = await visitorsCollection
      .find(
        {},
        {
          projection: {
            _id: 1
          }
        }
      )
      .sort({ createdAt: -1 })
      .skip(MAX_HISTORY)
      .limit(500)
      .toArray();

    if (oldRecords.length) {
      await visitorsCollection.deleteMany({
        _id: {
          $in: oldRecords.map(x => x._id)
        }
      });
    }
  } catch (error) {
    console.error("History trim error:", error.message);
  }
}

/* =========================================================
   RESPONSE FORMATTERS
========================================================= */

function currentVisitorResponse(visitor) {
  const fullIP = decryptIP(visitor.ipEncrypted);

  return {
    id: String(visitor._id),

    ip: fullIP || visitor.ipMasked,

    geo: visitor.geo,
    security: visitor.geo?.security || {},
      risk: calculateRiskScore(visitor),

    device: visitor.device,
    os: visitor.os,
    browser: visitor.browser,
    engine: visitor.engine,

    client: visitor.client || {},

    userAgent: visitor.userAgent,

    timestamp: visitor.createdAt
  };
}

function previewVisitorResponse(visitor) {
  return {
    id: String(visitor._id),

    ip: visitor.ipMasked,

    country: visitor.geo?.country || "Unknown",
    countryCode: visitor.geo?.countryCode || "",
    region: visitor.geo?.region || "Unknown",
    city: visitor.geo?.city || "Unknown",

    device: visitor.device,
    os: visitor.os,
    browser: visitor.browser,

    timestamp: visitor.createdAt
  };
}

function adminVisitorResponse(visitor) {
  const fullIP = decryptIP(visitor.ipEncrypted);

  return {
    id: String(visitor._id),

    ip: fullIP || visitor.ipMasked,
    maskedIP: visitor.ipMasked,

    geo: visitor.geo,
    security: visitor.geo?.security || {},

    device: visitor.device,
    os: visitor.os,
    browser: visitor.browser,
    engine: visitor.engine,

    client: visitor.client || {},

    userAgent: visitor.userAgent,

    referrer: visitor.referrer || "",
    language: visitor.language || "",

    analytics: visitor.analytics || {
      sessionId: visitor.sessionId || "",
      returningVisitor: false,
      previousVisits: 0
    },

    timestamp: visitor.createdAt
  };
}

/* =========================================================
   API - CURRENT VISITOR
========================================================= */

app.get("/api/track", async (req, res) => {
  try {
    const visitor = await createVisitor(req);

    const result = currentVisitorResponse(visitor);

    res.setHeader("Cache-Control", "no-store");

    res.json({
      success: true,
      visitor: result
    });

    broadcastLive(visitor);
  } catch (error) {
    console.error("/api/track:", error);

    res.status(500).json({
      success: false,
      error: "Unable to track visitor"
    });
  }
});

/* =========================================================
   API - ENRICHED TRACK
========================================================= */

app.post("/api/track", async (req, res) => {
  try {
    const visitor = await createVisitor(
      req,
      req.body?.client || {}
    );

    const result = currentVisitorResponse(visitor);

    res.setHeader("Cache-Control", "no-store");

    res.json({
      success: true,
      visitor: result
    });

    broadcastLive(visitor);
  } catch (error) {
    console.error("POST /api/track:", error);

    res.status(500).json({
      success: false,
      error: "Unable to track visitor"
    });
  }
});

/* =========================================================
   API - PUBLIC LAST 10 PREVIEW
========================================================= */

app.get("/api/history-preview", async (req, res) => {
  try {
    const records = await visitorsCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(PREVIEW_LIMIT)
      .toArray();

    res.setHeader("Cache-Control", "no-store");

    res.json({
      success: true,
      locked: true,
      count: records.length,
      data: records.map(previewVisitorResponse)
    });
  } catch (error) {
    console.error("/api/history-preview:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load preview"
    });
  }
});

/* =========================================================
   API - LOGIN
========================================================= */

app.post("/api/live/login", (req, res) => {
  const password = req.body?.password || "";

  if (!safeEqual(password, LIVE_PASSWORD)) {
    return res.status(401).json({
      success: false,
      error: "INVALID_PASSWORD"
    });
  }

  const token = createSessionToken();

  res.setHeader(
    "Set-Cookie",
    `rakib_live=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`
  );

  res.json({
    success: true
  });
});

/* =========================================================
   API - LOGOUT
========================================================= */

app.post("/api/live/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "rakib_live=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );

  res.json({
    success: true
  });
});

/* =========================================================
   API - AUTH STATUS
========================================================= */

app.get("/api/live/status", (req, res) => {
  const token = getCookie(req, "rakib_live");

  res.json({
    success: true,
    authenticated: verifySessionToken(token)
  });
});

/* =========================================================
   API - FULL HISTORY
========================================================= */

app.get("/api/history", requireAdmin, async (req, res) => {
  try {
    const records = await visitorsCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(MAX_HISTORY)
      .toArray();

    res.setHeader("Cache-Control", "no-store");

    res.json({
      success: true,
      locked: false,
      count: records.length,
      data: records.map(adminVisitorResponse)
    });
  } catch (error) {
    console.error("/api/history:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load history"
    });
  }
});

/* =========================================================
   API - STATS
========================================================= */

app.get("/api/stats", requireAdmin, async (req, res) => {
  try {
    const total = await visitorsCollection.countDocuments();

    const uniqueIPs = await visitorsCollection
      .aggregate([
        {
          $group: {
            _id: "$ipHash"
          }
        },
        {
          $count: "count"
        }
      ])
      .toArray();

    const countries = await visitorsCollection
      .aggregate([
        {
          $group: {
            _id: "$geo.country",
            count: {
              $sum: 1
            }
          }
        },
        {
          $sort: {
            count: -1
          }
        },
        {
          $limit: 10
        }
      ])
      .toArray();

    const devices = await visitorsCollection
      .aggregate([
        {
          $group: {
            _id: "$device.type",
            count: {
              $sum: 1
            }
          }
        },
        {
          $sort: {
            count: -1
          }
        }
      ])
      .toArray();

    const last24h = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    );

    const securityCounts = {
      vpn: await visitorsCollection.countDocuments({
        "geo.security.vpn": true
      }),
      proxy: await visitorsCollection.countDocuments({
        "geo.security.proxy": true
      }),
      tor: await visitorsCollection.countDocuments({
        "geo.security.tor": true
      }),
      hosting: await visitorsCollection.countDocuments({
        "geo.security.hosting": true
      })
    };

    const today = await visitorsCollection.countDocuments({
      createdAt: {
        $gte: last24h
      }
    });

    res.json({
      success: true,

      total,
      uniqueIPs: uniqueIPs[0]?.count || 0,
      last24h: today,
      security: securityCounts,

      countries: countries.map(x => ({
        country: x._id || "Unknown",
        count: x.count
      })),

      devices: devices.map(x => ({
        type: x._id || "Unknown",
        count: x.count
      }))
    });
  } catch (error) {
    console.error("/api/stats:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load stats"
    });
  }
});

/* =========================================================
   LIVE SSE
========================================================= */

app.get("/api/live", requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.flushHeaders?.();

  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      timestamp: Date.now()
    })}\n\n`
  );

  const client = {
    res
  };

  liveClients.add(client);

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {}
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    liveClients.delete(client);
  });
});

function broadcastLive(visitor) {
  const data = {
    type: "visitor",
    visitor: adminVisitorResponse(visitor),
    liveAt: Date.now()
  };

  const message = `data: ${JSON.stringify(data)}\n\n`;

  for (const client of liveClients) {
    try {
      client.res.write(message);
    } catch {
      liveClients.delete(client);
    }
  }
}

/* =========================================================
   SECURITY EVENT HELPER
========================================================= */

async function logSecurityEvent(req, type, details = {}) {
  try {
    if (!securityCollection) return;

    const ip = getClientIP(req);

    await securityCollection.insertOne({
      type: String(type || "unknown").slice(0, 100),
      ipHash: hashIP(ip),
      path: cleanPath(req.originalUrl || req.path),
      method: req.method,
      details,
      userAgent: String(
        req.headers["user-agent"] || ""
      ).slice(0, 500),
      createdAt: new Date()
    });
  } catch (error) {
    console.error("security log:", error.message);
  }
}

/* =========================================================
   SERVER ANALYTICS
========================================================= */



function getSessionFromRequest(req) {
  return req.rakibAnalytics?.sessionId || "";
}

async function touchAnalyticsSession(req) {
  if (!sessionsCollection) return null;

  const sessionId = getSessionFromRequest(req);

  if (!sessionId) return null;

  const now = new Date();
  const ip = getClientIP(req);
  const ipHash = hashIP(ip);

  const existing = activeSessions.get(sessionId);

  if (existing) {
    existing.lastSeen = Date.now();

    await sessionsCollection.updateOne(
      { sessionId },
      {
        $set: {
          lastSeen: now,
          updatedAt: now
        },
        $inc: {
          requestCount: 1
        }
      }
    );

    return existing;
  }

  const session = {
    sessionId,
    ipHash,
    userAgent: String(
      req.headers["user-agent"] || ""
    ).slice(0, 500),
    referrer: String(
      req.headers.referer || ""
    ).slice(0, 500),
    firstPath: cleanPath(req.originalUrl || req.path),
    requestCount: 1,
    createdAt: now,
    lastSeen: now,
    updatedAt: now
  };

  activeSessions.set(sessionId, {
    ...session,
    lastSeen: Date.now()
  });

  await sessionsCollection.updateOne(
    { sessionId },
    {
      $setOnInsert: session,
      $set: {
        lastSeen: now,
        updatedAt: now
      },
      $inc: {
        requestCount: 1
      }
    },
    { upsert: true }
  );

  return session;
}

/* =========================================================
   PAGE VIEW
========================================================= */

app.post("/api/analytics/pageview", async (req, res) => {
  try {
    const sessionId = getSessionFromRequest(req);

    const pathName = cleanPath(
      req.body?.path ||
      req.originalUrl ||
      "/"
    );

    const title = String(
      req.body?.title || ""
    ).slice(0, 200);

    const duration = Math.max(
      0,
      Number(req.body?.duration || 0)
    );

    const ip = getClientIP(req);

    await pageViewsCollection.insertOne({
      sessionId,
      ipHash: hashIP(ip),
      path: pathName,
      title,
      duration,
      referrer: String(
        req.headers.referer || ""
      ).slice(0, 500),
      createdAt: new Date()
    });

    res.json({
      success: true
    });
  } catch (error) {
    console.error("/api/analytics/pageview:", error);

    res.status(500).json({
      success: false,
      error: "Unable to save page view"
    });
  }
});

/* =========================================================
   SESSION CLEANUP
========================================================= */

setInterval(() => {
  const cutoff =
    Date.now() - SESSION_MAX_AGE;

  for (const [sessionId, session] of activeSessions) {
    if (
      Number(session.lastSeen || 0) < cutoff
    ) {
      activeSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000).unref?.();

/* =========================================================
   SERVER HEALTH
========================================================= */

app.get("/api/server-health", requireAdmin, async (req, res) => {
  try {
    const memory = process.memoryUsage();

    const usedMemoryMB =
      Math.round(memory.rss / 1024 / 1024);

    const heapUsedMB =
      Math.round(memory.heapUsed / 1024 / 1024);

    const heapTotalMB =
      Math.round(memory.heapTotal / 1024 / 1024);

    const totalMemoryMB =
      Math.round(os.totalmem() / 1024 / 1024);

    const freeMemoryMB =
      Math.round(os.freemem() / 1024 / 1024);

    const load = os.loadavg();

    const uptimeSeconds =
      Math.round(process.uptime());

    const averageResponse =
      analyticsState.requests
        ? Math.round(
            analyticsState.totalResponseTime /
            analyticsState.requests
          )
        : 0;

    res.json({
      success: true,

      server: {
        uptime: uptimeSeconds,
        startedAt: new Date(
          analyticsState.startedAt
        ).toISOString(),

        node: process.version,
        platform: process.platform,
        arch: process.arch,

        pid: process.pid,

        hostname: os.hostname(),

        cpuCount: os.cpus().length,

        load: {
          oneMinute: Number(load[0].toFixed(2)),
          fiveMinutes: Number(load[1].toFixed(2)),
          fifteenMinutes: Number(load[2].toFixed(2))
        },

        memory: {
          rssMB: usedMemoryMB,
          heapUsedMB,
          heapTotalMB,
          systemTotalMB: totalMemoryMB,
          systemFreeMB: freeMemoryMB,
          systemUsedPercent: Number(
            (
              ((totalMemoryMB - freeMemoryMB) /
                totalMemoryMB) *
              100
            ).toFixed(1)
          )
        },

        analytics: {
          requests: analyticsState.requests,
          errors: analyticsState.errors,
          errorRate: analyticsState.requests
            ? Number(
                (
                  (analyticsState.errors /
                    analyticsState.requests) *
                  100
                ).toFixed(2)
              )
            : 0,
          averageResponseMs: averageResponse,
          activeSessions: activeSessions.size,
          lastRequestAt:
            analyticsState.lastRequestAt
        }
      }
    });
  } catch (error) {
    console.error("/api/server-health:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load server health"
    });
  }
});

/* =========================================================
   ANALYTICS OVERVIEW
========================================================= */

app.get("/api/analytics/overview", requireAdmin, async (req, res) => {
  try {
    const now = Date.now();

    const lastHour = new Date(
      now - 60 * 60 * 1000
    );

    const last24h = new Date(
      now - 24 * 60 * 60 * 1000
    );

    const [
      requestsLastHour,
      requestsLast24h,
      pageViewsLast24h,
      sessionsLast24h,
      securityLast24h,
      returningVisitors24h,
      uniqueVisitors24h
    ] = await Promise.all([
      requestsCollection.countDocuments({
        createdAt: { $gte: lastHour }
      }),

      requestsCollection.countDocuments({
        createdAt: { $gte: last24h }
      }),

      pageViewsCollection.countDocuments({
        createdAt: { $gte: last24h }
      }),

      sessionsCollection.countDocuments({
        createdAt: { $gte: last24h }
      }),

      securityCollection.countDocuments({
        createdAt: { $gte: last24h }
      }),

      visitorsCollection.countDocuments({
        createdAt: { $gte: last24h },
        "analytics.returningVisitor": true
      }),

      visitorsCollection.distinct("ipHash", {
        createdAt: { $gte: last24h }
      })
    ]);

    const statusCodes =
      [...analyticsState.statusCodes.entries()]
        .map(([status, count]) => ({
          status: Number(status),
          count
        }))
        .sort((a, b) => b.count - a.count);

    const endpoints =
      [...analyticsState.endpoints.entries()]
        .map(([path, count]) => ({
          path,
          count
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

    res.json({
      success: true,

      activeSessions: activeSessions.size,

      lastHour: {
        requests: requestsLastHour
      },

      last24h: {
        requests: requestsLast24h,
        pageViews: pageViewsLast24h,
        sessions: sessionsLast24h,
        securityEvents: securityLast24h,
        returningVisitors: returningVisitors24h,
        uniqueVisitors: uniqueVisitors24h.length
      },

      runtime: {
        totalRequests: analyticsState.requests,
        errors: analyticsState.errors,
        averageResponseMs:
          analyticsState.requests
            ? Math.round(
                analyticsState.totalResponseTime /
                analyticsState.requests
              )
            : 0
      },

      statusCodes,
      endpoints
    });
  } catch (error) {
    console.error("/api/analytics/overview:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load analytics"
    });
  }
});

/* =========================================================
   REQUEST ANALYTICS
========================================================= */

app.get("/api/analytics/requests", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(
        Number(req.query.limit || 100),
        1
      ),
      500
    );

    const data =
      await requestsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .project({
          _id: 0,
          sessionId: 1,
          path: 1,
          method: 1,
          status: 1,
          duration: 1,
          createdAt: 1,
          referrer: 1
        })
        .toArray();

    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    console.error("/api/analytics/requests:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load request analytics"
    });
  }
});

/* =========================================================
   VISITOR SESSION DETAIL
========================================================= */

app.get(
  "/api/analytics/session/:sessionId",
  requireAdmin,
  async (req, res) => {
    try {
      const sessionId =
        String(req.params.sessionId || "").slice(0, 100);

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: "Missing session ID"
        });
      }

      const [
        session,
        pages,
        requests,
        visitors
      ] = await Promise.all([
        sessionsCollection.findOne(
          { sessionId },
          { projection: { _id: 0 } }
        ),

        pageViewsCollection
          .find({ sessionId })
          .sort({ createdAt: 1 })
          .limit(500)
          .project({
            _id: 0
          })
          .toArray(),

        requestsCollection
          .find({ sessionId })
          .sort({ createdAt: 1 })
          .limit(500)
          .project({
            _id: 0,
            path: 1,
            method: 1,
            status: 1,
            duration: 1,
            createdAt: 1
          })
          .toArray(),

        visitorsCollection
          .find({ sessionId })
          .sort({ createdAt: 1 })
          .limit(100)
          .project({
            ipEncrypted: 1,
            ipMasked: 1,
            geo: 1,
            device: 1,
            os: 1,
            browser: 1,
            analytics: 1,
            createdAt: 1
          })
          .toArray()
      ]);

      res.json({
        success: true,

        session: session || null,

        pages,
        requests,

        visitors: visitors.map(visitor => ({
          ip: (() => {
            try {
              return decryptIP(visitor.ipEncrypted);
            } catch {
              return visitor.ipMasked || "";
            }
          })(),

          maskedIP: visitor.ipMasked,

          geo: visitor.geo,
          device: visitor.device,
          os: visitor.os,
          browser: visitor.browser,
          analytics: visitor.analytics,
          timestamp: visitor.createdAt
        }))
      });
    } catch (error) {
      console.error(
        "/api/analytics/session/:sessionId:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Unable to load session"
      });
    }
  }
);

/* =========================================================
   SESSION ANALYTICS
========================================================= */

app.get("/api/analytics/sessions", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(
        Number(req.query.limit || 100),
        1
      ),
      500
    );

    const data =
      await sessionsCollection
        .find({})
        .sort({ lastSeen: -1 })
        .limit(limit)
        .project({
          _id: 0,
          sessionId: 1,
          ipHash: 1,
          userAgent: 1,
          firstPath: 1,
          requestCount: 1,
          createdAt: 1,
          lastSeen: 1,
          updatedAt: 1
        })
        .toArray();

    res.json({
      success: true,
      active: activeSessions.size,
      count: data.length,
      data
    });
  } catch (error) {
    console.error("/api/analytics/sessions:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load sessions"
    });
  }
});

/* =========================================================
   PAGE ANALYTICS
========================================================= */

app.get("/api/analytics/pages", requireAdmin, async (req, res) => {
  try {
    const pages =
      await pageViewsCollection
        .aggregate([
          {
            $group: {
              _id: "$path",
              views: {
                $sum: 1
              },
              averageDuration: {
                $avg: "$duration"
              }
            }
          },

          {
            $sort: {
              views: -1
            }
          },

          {
            $limit: 50
          }
        ])
        .toArray();

    res.json({
      success: true,

      pages: pages.map(item => ({
        path: item._id || "/",
        views: item.views,
        averageDuration: Math.round(
          item.averageDuration || 0
        )
      }))
    });
  } catch (error) {
    console.error("/api/analytics/pages:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load page analytics"
    });
  }
});

/* =========================================================
   SECURITY ANALYTICS
========================================================= */

app.get("/api/analytics/security", requireAdmin, async (req, res) => {
  try {
    const data =
      await securityCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(200)
        .project({
          _id: 0
        })
        .toArray();

    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    console.error("/api/analytics/security:", error);

    res.status(500).json({
      success: false,
      error: "Unable to load security analytics"
    });
  }
});

/* =========================================================
   ADMIN DATA CLEAR
========================================================= */

app.post("/api/admin/clear-data", requireAdmin, async (req, res) => {
  try {
    const type = String(req.body?.type || "").trim();

    const now = Date.now();

    let result = {
      success: true,
      type,
      deleted: {}
    };

    if (type === "history") {
      const deleted =
        await visitorsCollection.deleteMany({});

      result.deleted.visitors =
        deleted.deletedCount;
    }

    else if (type === "24h") {
      const since = new Date(
        now - 24 * 60 * 60 * 1000
      );

      const deleted =
        await visitorsCollection.deleteMany({
          createdAt: { $gte: since }
        });

      result.deleted.visitors =
        deleted.deletedCount;
    }

    else if (type === "7d") {
      const since = new Date(
        now - 7 * 24 * 60 * 60 * 1000
      );

      const deleted =
        await visitorsCollection.deleteMany({
          createdAt: { $gte: since }
        });

      result.deleted.visitors =
        deleted.deletedCount;
    }

    else if (type === "analytics") {
      const [
        requests,
        pages,
        security
      ] = await Promise.all([
        requestsCollection.deleteMany({}),
        pageViewsCollection.deleteMany({}),
        securityCollection.deleteMany({})
      ]);

      result.deleted.requests =
        requests.deletedCount;

      result.deleted.pageViews =
        pages.deletedCount;

      result.deleted.security =
        security.deletedCount;
    }

    else if (type === "sessions") {
      const deleted =
        await sessionsCollection.deleteMany({});

      activeSessions.clear();

      result.deleted.sessions =
        deleted.deletedCount;
    }

    else if (type === "everything") {
      const [
        visitors,
        sessions,
        pages,
        requests,
        security
      ] = await Promise.all([
        visitorsCollection.deleteMany({}),
        sessionsCollection.deleteMany({}),
        pageViewsCollection.deleteMany({}),
        requestsCollection.deleteMany({}),
        securityCollection.deleteMany({})
      ]);

      activeSessions.clear();

      result.deleted.visitors =
        visitors.deletedCount;

      result.deleted.sessions =
        sessions.deletedCount;

      result.deleted.pageViews =
        pages.deletedCount;

      result.deleted.requests =
        requests.deletedCount;

      result.deleted.security =
        security.deletedCount;
    }

    else {
      return res.status(400).json({
        success: false,
        error: "Invalid clear type"
      });
    }

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.json(result);

  } catch (error) {
    console.error(
      "/api/admin/clear-data:",
      error
    );

    res.status(500).json({
      success: false,
      error: "Unable to clear data"
    });
  }
});

/* =========================================================
   SPA FALLBACK
========================================================= */





app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================================================
   START
========================================================= */

async function start() {
  try {
    await connectMongo();

    app.listen(PORT, "0.0.0.0", () => {
      console.log("");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("  RAKIB IP TRACKER");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`  PORT: ${PORT}`);
      console.log("  MongoDB: CONNECTED");
      console.log("  IP Encryption: AES-256-GCM");
      console.log("  History: PROTECTED");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("");
    });
  } catch (error) {
    console.error("❌ Startup failed:", error);
    process.exit(1);
  }
}

start();

process.on("SIGINT", async () => {
  console.log("\nStopping...");

  for (const client of liveClients) {
    try {
      client.res.end();
    } catch {}
  }

  if (mongoClient) {
    await mongoClient.close();
  }

  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (mongoClient) {
    await mongoClient.close();
  }

  process.exit(0);
});
