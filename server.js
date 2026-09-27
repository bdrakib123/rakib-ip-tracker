require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
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

const liveClients = new Set();

/* =========================================================
   EXPRESS
========================================================= */

app.disable("x-powered-by");
app.set("trust proxy", true);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

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
          : null
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
      longitude: null
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

  await visitorsCollection.createIndex({
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

async function createVisitor(req) {
  const ip = getClientIP(req);
  const userAgent = req.headers["user-agent"] || "Unknown";

  const ua = parseUserAgent(userAgent);
  const geo = await getGeoData(ip);

  const visitor = {
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

    device: visitor.device,
    os: visitor.os,
    browser: visitor.browser,
    engine: visitor.engine,

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

    device: visitor.device,
    os: visitor.os,
    browser: visitor.browser,
    engine: visitor.engine,

    userAgent: visitor.userAgent,

    referrer: visitor.referrer || "",
    language: visitor.language || "",

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
    visitor: adminVisitorResponse(visitor)
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
