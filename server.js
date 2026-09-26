const express = require("express");
const path = require("path");
const UAParser = require("ua-parser-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   IP DETECTION
========================================================= */

function getClientIP(req) {
  // Cloudflare
  if (req.headers["cf-connecting-ip"]) {
    return req.headers["cf-connecting-ip"].trim();
  }

  // Render / reverse proxy
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

/* =========================================================
   PRIVATE IP CHECK
========================================================= */

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

/* =========================================================
   IP GEOLOCATION
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
    const url =
      `https://ipwho.is/${encodeURIComponent(ip)}`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "RakibIPTracker/1.0"
      }
    });

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

      country: data.country || null,

      countryCode:
        data.country_code || null,

      region:
        data.region || null,

      city:
        data.city || null,

      postal:
        data.postal || null,

      /*
       * These coordinates are approximate
       * IP-based coordinates, NOT GPS.
       */
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
          ? "Geolocation request timed out"
          : error.message
    };

  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   TRACK API
========================================================= */

app.get("/api/track", async (req, res) => {

  try {

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

    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.json({

      success: true,

      privacy: {
        exactGps: false,
        exactAddress: false,

        note:
          "Location is approximate IP-based geolocation."
      },

      visitor: {

        ip:
          ip || null,

        country:
          geo.country || null,

        countryCode:
          geo.countryCode || null,

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
          geo.longitude ?? null
      },

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
          result.engine.name || null,

        userAgent:
          uaString || null
      },

      server: {

        timestamp:
          new Date().toISOString()
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
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    status: true,

    service:
      "privacy-safe-ip-tracker",

    uptime:
      process.uptime(),

    timestamp:
      new Date().toISOString()
  });

});

/* =========================================================
   FRONTEND FALLBACK
   Express 5 compatible
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
   START SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `🚀 IP Tracker running on port ${PORT}`
    );

    console.log(
      `🌐 http://localhost:${PORT}`
    );

  }
);
