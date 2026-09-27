require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const UAParser = require("ua-parser-js");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "goatbot";
const LIVE_PASSWORD = process.env.LIVE_PASSWORD || "rakib69";

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing");
  process.exit(1);
}

app.set("trust proxy", true);

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

let mongoClient;
let db;
let visitorsCollection;

const sseClients = new Set();
const rateMap = new Map();

const MAX_TRACK_PER_MINUTE = 20;
const MAX_HISTORY = 10000;

/* =========================================================
   MONGODB
========================================================= */

async function connectMongo() {
  mongoClient = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000
  });

  await mongoClient.connect();

  db = mongoClient.db(DB_NAME);
  visitorsCollection = db.collection("ip_visitors");

  await visitorsCollection.createIndex({ createdAt: -1 });
  await visitorsCollection.createIndex({ ipHash: 1 });
  await visitorsCollection.createIndex({ countryCode: 1 });
  await visitorsCollection.createIndex({ "device.type": 1 });

  console.log(`☁️ MongoDB connected: ${DB_NAME}`);
}

/* =========================================================
   HELPERS
========================================================= */

function getClientIP(req) {
  const cf = req.headers["cf-connecting-ip"];

  if (cf) {
    return String(cf).trim();
  }

  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }

  const realIP = req.headers["x-real-ip"];

  if (realIP) {
    return String(realIP).trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  ).replace(/^::ffff:/, "");
}

function normalizeIP(ip) {
  if (!ip) return "";

  return String(ip)
    .trim()
    .replace(/^::ffff:/, "");
}

function isPrivateIP(ip) {
  if (!ip) return true;

  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "localhost"
  ) {
    return true;
  }

  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.20.") ||
    ip.startsWith("172.21.") ||
    ip.startsWith("172.22.") ||
    ip.startsWith("172.23.") ||
    ip.startsWith("172.24.") ||
    ip.startsWith("172.25.") ||
    ip.startsWith("172.26.") ||
    ip.startsWith("172.27.") ||
    ip.startsWith("172.28.") ||
    ip.startsWith("172.29.") ||
    ip.startsWith("172.30.") ||
    ip.startsWith("172.31.")
  ) {
    return true;
  }

  return false;
}

function maskIP(ip) {
  if (!ip) return "Unknown";

  if (ip.includes(".")) {
    const p = ip.split(".");

    if (p.length === 4) {
      return `${p[0]}.${p[1]}.${p[2]}.xxx`;
    }
  }

  if (ip.includes(":")) {
    return ip.split(":").slice(0, 3).join(":") + ":****";
  }

  return "Hidden";
}

function hashIP(ip) {
  return crypto
    .createHash("sha256")
    .update(`${ip}:${process.env.MONGODB_DB || "goatbot"}`)
    .digest("hex");
}

function getFlag(code) {
  if (!code || code.length !== 2) return "🌐";

  return code
    .toUpperCase()
    .replace(/./g, char =>
      String.fromCodePoint(127397 + char.charCodeAt(0))
    );
}

function clean(value, fallback = "Unknown") {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  return String(value);
}

/* =========================================================
   RATE LIMIT
========================================================= */

function rateLimited(ip) {
  const now = Date.now();

  const old = rateMap.get(ip) || [];

  const fresh = old.filter(
    time => now - time < 60 * 1000
  );

  fresh.push(now);

  rateMap.set(ip, fresh);

  return fresh.length > MAX_TRACK_PER_MINUTE;
}

/* =========================================================
   GEO LOOKUP
========================================================= */

async function geoLookup(ip) {
  if (!ip || isPrivateIP(ip)) {
    return {
      success: false
    };
  }

  try {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      7000
    );

    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "Rakib-IP-Tracker/3.0"
        }
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false };
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/* =========================================================
   CREATE VISITOR
========================================================= */

async function createVisitor(req) {
  const ip = normalizeIP(getClientIP(req));

  const userAgent =
    req.headers["user-agent"] || "";

  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  const geo = await geoLookup(ip);

  const countryCode =
    geo?.country_code || "";

  const visitor = {
    visitorId: crypto.randomUUID(),

    ipHash: hashIP(ip),

    /*
      Raw IP is intentionally NOT stored.
      History only exposes masked IP.
    */
    ipMasked: maskIP(ip),

    country: clean(geo?.country),
    countryCode: clean(countryCode),
    flag: getFlag(countryCode),

    region: clean(geo?.region),
    city: clean(geo?.city),
    postal: clean(geo?.postal),

    timezone: clean(
      geo?.timezone?.id ||
      geo?.timezone
    ),

    isp: clean(geo?.connection?.isp),
    organization: clean(
      geo?.connection?.org
    ),

    asn: clean(
      geo?.connection?.asn
    ),

    location: {
      latitude:
        typeof geo?.latitude === "number"
          ? geo.latitude
          : null,

      longitude:
        typeof geo?.longitude === "number"
          ? geo.longitude
          : null
    },

    device: {
      type: clean(result.device?.type, "desktop"),
      vendor: clean(result.device?.vendor),
      model: clean(result.device?.model),
      os: clean(
        result.os?.name
          ? `${result.os.name} ${result.os.version || ""}`.trim()
          : "Unknown"
      ),
      browser: clean(
        result.browser?.name
          ? `${result.browser.name} ${result.browser.version || ""}`.trim()
          : "Unknown"
      ),
      engine: clean(
        result.engine?.name
          ? `${result.engine.name} ${result.engine.version || ""}`.trim()
          : "Unknown"
      )
    },

    userAgent: userAgent.slice(0, 1000),

    createdAt: new Date()
  };

  return visitor;
}

/* =========================================================
   SAFE RESPONSE
========================================================= */

function safeVisitor(v) {
  return {
    visitorId: v.visitorId,

    ip: v.ipMasked,

    country: v.country,
    countryCode: v.countryCode,
    flag: v.flag,

    region: v.region,
    city: v.city,
    postal: v.postal,

    timezone: v.timezone,

    isp: v.isp,
    organization: v.organization,
    asn: v.asn,

    location: {
      latitude: v.location?.latitude ?? null,
      longitude: v.location?.longitude ?? null
    },

    device: v.device,

    userAgent: v.userAgent,

    createdAt: v.createdAt
  };
}

/* =========================================================
   SSE
========================================================= */

function broadcast(type, data) {
  const payload =
    `event: ${type}\n` +
    `data: ${JSON.stringify(data)}\n\n`;

  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/* =========================================================
   TRACK
========================================================= */

app.get("/api/track", async (req, res) => {
  try {
    const ip = normalizeIP(getClientIP(req));

    if (rateLimited(ip)) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Try again later."
      });
    }

    const visitor = await createVisitor(req);

    await visitorsCollection.insertOne(visitor);

    /*
      Prevent unlimited database growth.
      Keep newest MAX_HISTORY records.
    */
    const total =
      await visitorsCollection.countDocuments();

    if (total > MAX_HISTORY) {
      const removeCount =
        total - MAX_HISTORY;

      const oldVisitors =
        await visitorsCollection
          .find(
            {},
            {
              projection: {
                _id: 1
              }
            }
          )
          .sort({ createdAt: 1 })
          .limit(removeCount)
          .toArray();

      if (oldVisitors.length) {
        await visitorsCollection.deleteMany({
          _id: {
            $in: oldVisitors.map(v => v._id)
          }
        });
      }
    }

    const safe = safeVisitor(visitor);

    broadcast("visitor", safe);

    res.json({
      success: true,
      privacy: {
        exactGps: false,
        exactAddress: false,
        rawIPStored: false,
        note:
          "Approximate IP-based location only."
      },
      visitor: safe
    });
  } catch (error) {
    console.error("TRACK ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Unable to track visitor."
    });
  }
});

/* =========================================================
   HISTORY
========================================================= */

app.get("/api/history", async (req, res) => {
  try {
    const limit = Math.min(
      Number(req.query.limit) || 30,
      100
    );

    const data =
      await visitorsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

    res.json({
      success: true,
      total: data.length,
      data: data.map(safeVisitor)
    });
  } catch (error) {
    console.error("HISTORY ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load history."
    });
  }
});

/* =========================================================
   STATS
========================================================= */

app.get("/api/stats", async (req, res) => {
  try {
    const total =
      await visitorsCollection.countDocuments();

    const countries =
      await visitorsCollection
        .aggregate([
          {
            $group: {
              _id: "$country",
              count: { $sum: 1 }
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

    const devices =
      await visitorsCollection
        .aggregate([
          {
            $group: {
              _id: "$device.type",
              count: { $sum: 1 }
            }
          },
          {
            $sort: {
              count: -1
            }
          }
        ])
        .toArray();

    const browsers =
      await visitorsCollection
        .aggregate([
          {
            $group: {
              _id: "$device.browser",
              count: { $sum: 1 }
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

    const isps =
      await visitorsCollection
        .aggregate([
          {
            $group: {
              _id: "$isp",
              count: { $sum: 1 }
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

    const todayStart = new Date();

    todayStart.setHours(0, 0, 0, 0);

    const today =
      await visitorsCollection.countDocuments({
        createdAt: {
          $gte: todayStart
        }
      });

    res.json({
      success: true,

      totalVisitors: total,

      todayVisitors: today,

      countries: countries.map(x => ({
        name: x._id || "Unknown",
        count: x.count
      })),

      devices: devices.map(x => ({
        name: x._id || "Unknown",
        count: x.count
      })),

      browsers: browsers.map(x => ({
        name: x._id || "Unknown",
        count: x.count
      })),

      isps: isps.map(x => ({
        name: x._id || "Unknown",
        count: x.count
      }))
    });
  } catch (error) {
    console.error("STATS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load statistics."
    });
  }
});

/* =========================================================
   LIVE STREAM
========================================================= */

app.get("/api/live", (req, res) => {
  res.setHeader(
    "Content-Type",
    "text/event-stream"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.setHeader(
    "X-Accel-Buffering",
    "no"
  );

  res.flushHeaders();

  res.write(
    `event: connected\ndata: ${JSON.stringify({
      success: true,
      time: new Date()
    })}\n\n`
  );

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

/* =========================================================
   LIVE PASSWORD
========================================================= */

app.post("/api/live/auth", (req, res) => {
  const password =
    typeof req.body?.password === "string"
      ? req.body.password
      : "";

  if (
    password.length === 0 ||
    password !== LIVE_PASSWORD
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid live access password."
    });
  }

  const token = crypto
    .randomBytes(32)
    .toString("hex");

  /*
    Lightweight in-memory live tokens.
    Token expires after 30 minutes.
  */
  if (!global.liveTokens) {
    global.liveTokens = new Map();
  }

  global.liveTokens.set(token, {
    expires: Date.now() + 30 * 60 * 1000
  });

  res.json({
    success: true,
    token,
    expiresIn: 1800
  });
});

function requireLiveAuth(req, res, next) {
  const token =
    req.headers.authorization?.replace(
      /^Bearer\s+/i,
      ""
    );

  if (
    !token ||
    !global.liveTokens?.has(token)
  ) {
    return res.status(401).json({
      success: false,
      message: "Live authentication required."
    });
  }

  const session =
    global.liveTokens.get(token);

  if (session.expires < Date.now()) {
    global.liveTokens.delete(token);

    return res.status(401).json({
      success: false,
      message: "Live session expired."
    });
  }

  next();
}

/*
  Password-protected snapshot.
*/
app.get(
  "/api/live/history",
  requireLiveAuth,
  async (req, res) => {
    try {
      const data =
        await visitorsCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray();

      res.json({
        success: true,
        data: data.map(safeVisitor)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Unable to load live data."
      });
    }
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", async (req, res) => {
  let mongo = "offline";

  try {
    await db.command({
      ping: 1
    });

    mongo = "online";
  } catch {}

  res.json({
    success: true,
    service: "Rakib IP Intelligence",
    version: "3.0.0",
    mongo,
    liveClients: sseClients.size,
    time: new Date().toISOString()
  });
});

/* =========================================================
   FRONTEND
========================================================= */

app.use((req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   START
========================================================= */

connectMongo()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log("");
      console.log("╔══════════════════════════════════╗");
      console.log("║   RAKIB IP INTELLIGENCE v3.0    ║");
      console.log("╠══════════════════════════════════╣");
      console.log(`║ PORT       : ${PORT}`);
      console.log(`║ DATABASE   : ${DB_NAME}`);
      console.log("║ MONGODB    : ONLINE");
      console.log("║ LIVE       : PASSWORD PROTECTED");
      console.log("╚══════════════════════════════════╝");
      console.log("");
    });
  })
  .catch(error => {
    console.error("❌ MongoDB connection failed:");
    console.error(error);
    process.exit(1);
  });

/* =========================================================
   CLEANUP
========================================================= */

setInterval(() => {
  const now = Date.now();

  for (const [ip, times] of rateMap) {
    const fresh = times.filter(
      t => now - t < 60 * 1000
    );

    if (fresh.length) {
      rateMap.set(ip, fresh);
    } else {
      rateMap.delete(ip);
    }
  }

  if (global.liveTokens) {
    for (const [token, session] of global.liveTokens) {
      if (session.expires < now) {
        global.liveTokens.delete(token);
      }
    }
  }
}, 60 * 1000);
