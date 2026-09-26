const express = require("express");
const path = require("path");
const UAParser = require("ua-parser-js");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   CONFIG
========================================================= */

const MAX_HISTORY = 50;
const RATE_WINDOW = 60 * 1000;
const RATE_LIMIT = 20;

/*
 * RAM only.
 * Restarting the server clears everything.
 */
const visitors = [];
const rateMap = new Map();
const sseClients = new Set();

/* =========================================================
   HELPERS
========================================================= */

function getClientIP(req) {
  if (req.headers["cf-connecting-ip"]) {
    return req.headers["cf-connecting-ip"].trim();
  }

  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  if (req.headers["x-real-ip"]) {
    return req.headers["x-real-ip"].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  ).replace(/^::ffff:/, "");
}

function isPrivateIP(ip) {
  if (!ip) return true;

  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    /^fc00:/i.test(ip) ||
    /^fd00:/i.test(ip) ||
    /^fe80:/i.test(ip)
  );
}

function maskIP(ip) {
  if (!ip) return "Unknown";

  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 3).join(":")}:****`;
  }

  const parts = ip.split(".");

  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  }

  return "Masked";
}

function flagEmoji(code) {
  if (!code || code.length !== 2) {
    return "🌐";
  }

  return code
    .toUpperCase()
    .split("")
    .map(c => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

function shortId() {
  return crypto.randomBytes(4).toString("hex");
}

/* =========================================================
   RATE LIMIT
========================================================= */

function rateLimit(req, res, next) {
  const ip = getClientIP(req);
  const now = Date.now();

  let record = rateMap.get(ip);

  if (!record || now - record.start > RATE_WINDOW) {
    record = {
      start: now,
      count: 0
    };
  }

  record.count++;
  rateMap.set(ip, record);

  if (record.count > RATE_LIMIT) {
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please try again later."
    });
  }

  next();
}

/* =========================================================
   GEO LOOKUP
========================================================= */

async function geoLookup(ip) {
  if (!ip || isPrivateIP(ip)) {
    return {
      status: "private",
      country: null,
      countryCode: null,
      region: null,
      city: null,
      postal: null,
      latitude: null,
      longitude: null,
      timezone: null,
      isp: null,
      org: null,
      asn: null
    };
  }

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, 5000);

  try {
    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "RakibIPTracker/2.0"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Geo service HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!data.success) {
      return {
        status: "unavailable",
        error: data.message || "IP lookup failed"
      };
    }

    return {
      status: "success",

      country:
        data.country || null,

      countryCode:
        data.country_code || null,

      region:
        data.region || null,

      city:
        data.city || null,

      postal:
        data.postal || null,

      latitude:
        data.latitude ?? null,

      longitude:
        data.longitude ?? null,

      timezone:
        data.timezone?.id || null,

      isp:
        data.connection?.isp || null,

      org:
        data.connection?.org || null,

      asn:
        data.connection?.asn
          ? `AS${data.connection.asn}`
          : null
    };

  } catch (error) {

    return {
      status: "unavailable",

      error:
        error.name === "AbortError"
          ? "Geolocation timeout"
          : error.message
    };

  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   CREATE VISITOR
========================================================= */

async function createVisitor(req) {

  const ip = getClientIP(req);

  const uaString =
    req.get("user-agent") || "";

  const parser =
    new UAParser(uaString);

  const result =
    parser.getResult();

  const geo =
    await geoLookup(ip);

  const deviceType =
    result.device.type ||
    (result.device.model
      ? "mobile"
      : "desktop");

  const now =
    new Date();

  return {

    id:
      shortId(),

    time:
      now.toISOString(),

    timeUnix:
      Date.now(),

    ip:
      ip || null,

    maskedIP:
      maskIP(ip),

    country:
      geo.country || null,

    countryCode:
      geo.countryCode || null,

    flag:
      flagEmoji(geo.countryCode),

    region:
      geo.region || null,

    city:
      geo.city || null,

    postal:
      geo.postal || null,

    timezone:
      geo.timezone || null,

    isp:
      geo.isp || null,

    organization:
      geo.org || null,

    asn:
      geo.asn || null,

    latitude:
      geo.latitude ?? null,

    longitude:
      geo.longitude ?? null,

    device: {

      type:
        deviceType,

      vendor:
        result.device.vendor || null,

      model:
        result.device.model || null,

      os:
        result.os.name
          ? `${result.os.name}${
              result.os.version
                ? ` ${result.os.version}`
                : ""
            }`
          : null,

      browser:
        result.browser.name
          ? `${result.browser.name}${
              result.browser.version
                ? ` ${result.browser.version}`
                : ""
            }`
          : null,

      engine:
        result.engine.name || null
    }
  };
}

/* =========================================================
   BROADCAST
========================================================= */

function broadcast(visitor) {

  const payload =
    JSON.stringify(visitor);

  for (const client of sseClients) {

    try {

      client.write(
        `event: visitor\n`
      );

      client.write(
        `data: ${payload}\n\n`
      );

    } catch {
      sseClients.delete(client);
    }
  }
}

/* =========================================================
   TRACK API
========================================================= */

app.get(
  "/api/track",
  rateLimit,
  async (req, res) => {

    try {

      const visitor =
        await createVisitor(req);

      visitors.unshift(visitor);

      if (visitors.length > MAX_HISTORY) {
        visitors.length = MAX_HISTORY;
      }

      broadcast(visitor);

      res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
      );

      res.json({

        success: true,

        privacy: {

          exactGps: false,

          exactAddress: false,

          historyPersistent: false,

          note:
            "Location is approximate IP-based geolocation."
        },

        visitor: {

          ip:
            visitor.ip,

          country:
            visitor.country,

          countryCode:
            visitor.countryCode,

          region:
            visitor.region,

          city:
            visitor.city,

          postal:
            visitor.postal,

          timezone:
            visitor.timezone,

          isp:
            visitor.isp,

          organization:
            visitor.organization,

          asn:
            visitor.asn,

          latitude:
            visitor.latitude,

          longitude:
            visitor.longitude
        },

        device:
          {
            ...visitor.device,
            userAgent:
              req.get("user-agent") || null
          },

        server: {

          timestamp:
            visitor.time
        }

      });

    } catch (error) {

      console.error(
        "TRACK ERROR:",
        error
      );

      res.status(500).json({

        success: false,

        error:
          "Unable to collect visitor information."
      });
    }
  }
);

/* =========================================================
   HISTORY API
========================================================= */

app.get("/api/history", (req, res) => {

  const safeVisitors =
    visitors.map(v => ({
      id: v.id,
      time: v.time,
      timeUnix: v.timeUnix,

      ip: v.maskedIP,

      country: v.country,
      countryCode: v.countryCode,
      flag: v.flag,

      region: v.region,
      city: v.city,

      timezone: v.timezone,

      isp: v.isp,
      organization: v.organization,
      asn: v.asn,

      latitude: v.latitude,
      longitude: v.longitude,

      device: v.device
    }));

  const countries = {};

  for (const visitor of safeVisitors) {

    const country =
      visitor.country || "Unknown";

    countries[country] =
      (countries[country] || 0) + 1;
  }

  const devices = {};

  for (const visitor of safeVisitors) {

    const type =
      visitor.device?.type || "unknown";

    devices[type] =
      (devices[type] || 0) + 1;
  }

  res.json({

    success: true,

    total:
      safeVisitors.length,

    countries,

    devices,

    visitors:
      safeVisitors
  });

});

/* =========================================================
   LIVE SSE
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

  res.flushHeaders?.();

  sseClients.add(res);

  res.write(
    `event: connected\ndata: ${JSON.stringify({
      connected: true,
      time: new Date().toISOString()
    })}\n\n`
  );

  const heartbeat =
    setInterval(() => {

      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }

    }, 25000);

  req.on("close", () => {

    clearInterval(heartbeat);

    sseClients.delete(res);

  });

});

/* =========================================================
   STATS
========================================================= */

app.get("/api/stats", (req, res) => {

  const countrySet =
    new Set(
      visitors
        .map(v => v.country)
        .filter(Boolean)
    );

  const mobile =
    visitors.filter(
      v => v.device?.type === "mobile"
    ).length;

  const desktop =
    visitors.filter(
      v => v.device?.type === "desktop"
    ).length;

  const tablet =
    visitors.filter(
      v => v.device?.type === "tablet"
    ).length;

  res.json({

    success: true,

    total:
      visitors.length,

    countries:
      countrySet.size,

    mobile,

    desktop,

    tablet,

    live:
      sseClients.size,

    uptime:
      process.uptime(),

    timestamp:
      new Date().toISOString()
  });

});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    status: true,

    service:
      "rakib-ip-tracker",

    version:
      "2.0.0",

    uptime:
      process.uptime(),

    visitors:
      visitors.length,

    timestamp:
      new Date().toISOString()
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

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");
    console.log(
      "╔══════════════════════════════════╗"
    );

    console.log(
      "║     RAKIB IP TRACKER v2.0       ║"
    );

    console.log(
      "╠══════════════════════════════════╣"
    );

    console.log(
      `║  Port: ${PORT}`
    );

    console.log(
      "║  Live feed: ENABLED"
    );

    console.log(
      "║  History: RAM ONLY"
    );

    console.log(
      "║  Rate limit: 20/min/IP"
    );

    console.log(
      "╚══════════════════════════════════╝"
    );

    console.log("");

  }
);
