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
  console.error("❌ MONGODB_URI missing");
  process.exit(1);
}

app.set("trust proxy", true);

app.use(express.json({ limit: "100kb" }));

app.use(express.static(
  path.join(__dirname, "public")
));

let mongoClient;
let db;
let visitorsCollection;

const liveClients = new Set();
const rateMap = new Map();
const liveSessions = new Map();

const MAX_HISTORY = 10000;
const TRACK_LIMIT = 20;

/* =========================================================
   MONGODB
========================================================= */

async function connectMongo() {

  mongoClient = new MongoClient(
    MONGODB_URI,
    {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    }
  );

  await mongoClient.connect();

  db = mongoClient.db(DB_NAME);

  visitorsCollection =
    db.collection("ip_visitors");

  await visitorsCollection.createIndex({
    createdAt: -1
  });

  await visitorsCollection.createIndex({
    ipHash: 1
  });

  await visitorsCollection.createIndex({
    countryCode: 1
  });

  await visitorsCollection.createIndex({
    "device.type": 1
  });

  console.log(
    `☁️ MongoDB connected: ${DB_NAME}`
  );
}


/* =========================================================
   IP
========================================================= */

function getClientIP(req) {

  const cf =
    req.headers["cf-connecting-ip"];

  if (cf) {
    return String(cf).trim();
  }

  const forwarded =
    req.headers["x-forwarded-for"];

  if (forwarded) {
    return String(
      forwarded
    ).split(",")[0].trim();
  }

  const real =
    req.headers["x-real-ip"];

  if (real) {
    return String(real).trim();
  }

  return String(
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  ).replace(/^::ffff:/, "");
}


function normalizeIP(ip) {

  return String(ip || "")
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


/* =========================================================
   PRIVACY
========================================================= */

function maskIP(ip) {

  if (!ip) {
    return "Unknown";
  }

  if (ip.includes(".")) {

    const parts =
      ip.split(".");

    if (parts.length === 4) {
      return (
        `${parts[0]}.` +
        `${parts[1]}.` +
        `${parts[2]}.xxx`
      );
    }
  }

  if (ip.includes(":")) {

    return (
      ip
        .split(":")
        .slice(0, 3)
        .join(":") +
      ":****"
    );
  }

  return "Hidden";
}


function hashIP(ip) {

  return crypto
    .createHash("sha256")
    .update(
      `${ip}:${DB_NAME}`
    )
    .digest("hex");
}


function getFlag(code) {

  if (
    !code ||
    code.length !== 2
  ) {
    return "🌐";
  }

  return code
    .toUpperCase()
    .replace(
      /./g,
      char =>
        String.fromCodePoint(
          127397 +
          char.charCodeAt(0)
        )
    );
}


function clean(
  value,
  fallback = "Unavailable"
) {

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

  const old =
    rateMap.get(ip) || [];

  const fresh =
    old.filter(
      t => now - t < 60000
    );

  fresh.push(now);

  rateMap.set(
    ip,
    fresh
  );

  return (
    fresh.length >
    TRACK_LIMIT
  );
}


/* =========================================================
   GEO
========================================================= */

async function geoLookup(ip) {

  if (
    !ip ||
    isPrivateIP(ip)
  ) {
    return {
      success: false
    };
  }

  try {

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        7000
      );

    const response =
      await fetch(
        `https://ipwho.is/${encodeURIComponent(ip)}`,
        {
          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Rakib-IP-Tracker/3.0"
          }
        }
      );

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false
      };
    }

    return await response.json();

  } catch {

    return {
      success: false
    };
  }
}


/* =========================================================
   CREATE VISITOR
========================================================= */

async function createVisitor(req) {

  const ip =
    normalizeIP(
      getClientIP(req)
    );

  const userAgent =
    req.headers["user-agent"] ||
    "";

  const parser =
    new UAParser(userAgent);

  const parsed =
    parser.getResult();

  const geo =
    await geoLookup(ip);

  const countryCode =
    geo?.country_code || "";

  return {

    visitorId:
      crypto.randomUUID(),

    /*
      Raw IP is NEVER stored.
    */

    ipHash:
      hashIP(ip),

    ipMasked:
      maskIP(ip),

    country:
      clean(geo?.country),

    countryCode:
      clean(countryCode),

    flag:
      getFlag(countryCode),

    region:
      clean(geo?.region),

    city:
      clean(geo?.city),

    postal:
      clean(geo?.postal),

    timezone:
      clean(
        geo?.timezone?.id
      ),

    isp:
      clean(
        geo?.connection?.isp
      ),

    organization:
      clean(
        geo?.connection?.org
      ),

    asn:
      clean(
        geo?.connection?.asn
      ),

    location: {

      latitude:
        typeof geo?.latitude ===
        "number"
          ? geo.latitude
          : null,

      longitude:
        typeof geo?.longitude ===
        "number"
          ? geo.longitude
          : null
    },

    device: {

      type:
        clean(
          parsed.device?.type,
          "desktop"
        ),

      vendor:
        clean(
          parsed.device?.vendor
        ),

      model:
        clean(
          parsed.device?.model
        ),

      os:
        parsed.os?.name
          ? `${parsed.os.name} ${parsed.os.version || ""}`.trim()
          : "Unavailable",

      browser:
        parsed.browser?.name
          ? `${parsed.browser.name} ${parsed.browser.version || ""}`.trim()
          : "Unavailable",

      engine:
        parsed.engine?.name
          ? `${parsed.engine.name} ${parsed.engine.version || ""}`.trim()
          : "Unavailable"
    },

    userAgent:
      userAgent.slice(0, 1000),

    createdAt:
      new Date()
  };
}


/* =========================================================
   SAFE VISITOR
========================================================= */

function safeVisitor(visitor) {

  return {

    visitorId:
      visitor.visitorId,

    ip:
      visitor.ipMasked,

    country:
      visitor.country,

    countryCode:
      visitor.countryCode,

    flag:
      visitor.flag,

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

    location: {

      latitude:
        visitor.location?.latitude ??
        null,

      longitude:
        visitor.location?.longitude ??
        null
    },

    device:
      visitor.device,

    userAgent:
      visitor.userAgent,

    createdAt:
      visitor.createdAt
  };
}


/* =========================================================
   TRACK
========================================================= */

app.get(
  "/api/track",
  async (req, res) => {

    try {

      const ip =
        normalizeIP(
          getClientIP(req)
        );

      if (rateLimited(ip)) {

        return res
          .status(429)
          .json({
            success: false,
            message:
              "Too many requests."
          });
      }

      const visitor =
        await createVisitor(req);

      await visitorsCollection
        .insertOne(visitor);

      /*
        Keep database bounded.
      */

      const total =
        await visitorsCollection
          .countDocuments();

      if (
        total >
        MAX_HISTORY
      ) {

        const removeCount =
          total -
          MAX_HISTORY;

        const old =
          await visitorsCollection
            .find(
              {},
              {
                projection: {
                  _id: 1
                }
              }
            )
            .sort({
              createdAt: 1
            })
            .limit(removeCount)
            .toArray();

        if (old.length) {

          await visitorsCollection
            .deleteMany({
              _id: {
                $in:
                  old.map(
                    x => x._id
                  )
              }
            });
        }
      }

      /*
        IMPORTANT:

        /api/track returns ONLY
        this visitor's own record.

        No history here.
      */

      res.json({

        success: true,

        privacy: {

          exactGps: false,

          exactAddress: false,

          rawIPStored: false,

          historyProtected: true,

          note:
            "Approximate IP-based location only."
        },

        visitor:
          safeVisitor(visitor)
      });

    } catch (error) {

      console.error(
        "TRACK ERROR:",
        error
      );

      res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to process visitor."
        });
    }
  }
);


/* =========================================================
   LIVE AUTH
========================================================= */

app.post(
  "/api/live/auth",
  async (req, res) => {

    const password =
      typeof req.body?.password ===
      "string"
        ? req.body.password
        : "";

    if (
      !password ||
      password !== LIVE_PASSWORD
    ) {

      return res
        .status(401)
        .json({
          success: false,
          message:
            "Invalid password."
        });
    }

    const token =
      crypto.randomBytes(32)
        .toString("hex");

    liveSessions.set(
      token,
      {
        createdAt: Date.now(),
        expiresAt:
          Date.now() +
          30 * 60 * 1000
      }
    );

    /*
      HttpOnly cookie means
      frontend JavaScript doesn't
      need to expose the token.
    */

    res.cookie = undefined;

    res.setHeader(
      "Set-Cookie",
      [
        `live_token=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=1800`
      ]
    );

    res.json({
      success: true,
      expiresIn: 1800
    });
  }
);


/* =========================================================
   LIVE AUTH CHECK
========================================================= */

function getCookie(req, name) {

  const header =
    req.headers.cookie;

  if (!header) {
    return null;
  }

  const cookies =
    header.split(";");

  for (
    const cookie of cookies
  ) {

    const index =
      cookie.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      cookie
        .slice(0, index)
        .trim();

    const value =
      cookie
        .slice(index + 1)
        .trim();

    if (key === name) {
      return decodeURIComponent(
        value
      );
    }
  }

  return null;
}


function requireLiveAuth(
  req,
  res,
  next
) {

  const token =
    getCookie(
      req,
      "live_token"
    );

  if (!token) {

    return res
      .status(401)
      .json({
        success: false,
        message:
          "Live access required."
      });
  }

  const session =
    liveSessions.get(token);

  if (
    !session ||
    session.expiresAt <
      Date.now()
  ) {

    liveSessions.delete(token);

    return res
      .status(401)
      .json({
        success: false,
        message:
          "Live session expired."
      });
  }

  next();
}


/* =========================================================
   HISTORY - PASSWORD PROTECTED
========================================================= */

app.get(
  "/api/history",
  requireLiveAuth,
  async (req, res) => {

    try {

      const limit =
        Math.min(
          Number(req.query.limit) ||
            30,
          100
        );

      const records =
        await visitorsCollection
          .find({})
          .sort({
            createdAt: -1
          })
          .limit(limit)
          .toArray();

      res.json({

        success: true,

        total:
          records.length,

        data:
          records.map(
            safeVisitor
          )
      });

    } catch (error) {

      console.error(
        "HISTORY ERROR:",
        error
      );

      res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to load history."
        });
    }
  }
);


/* =========================================================
   STATS - PASSWORD PROTECTED
========================================================= */

app.get(
  "/api/stats",
  requireLiveAuth,
  async (req, res) => {

    try {

      const total =
        await visitorsCollection
          .countDocuments();

      const countries =
        await visitorsCollection
          .aggregate([

            {
              $group: {
                _id: "$country",
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

      const devices =
        await visitorsCollection
          .aggregate([

            {
              $group: {
                _id:
                  "$device.type",
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

      const browsers =
        await visitorsCollection
          .aggregate([

            {
              $group: {
                _id:
                  "$device.browser",
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

      const isps =
        await visitorsCollection
          .aggregate([

            {
              $group: {
                _id: "$isp",
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

      const start =
        new Date();

      start.setHours(
        0,
        0,
        0,
        0
      );

      const today =
        await visitorsCollection
          .countDocuments({
            createdAt: {
              $gte: start
            }
          });

      res.json({

        success: true,

        totalVisitors:
          total,

        todayVisitors:
          today,

        countries:
          countries.map(
            x => ({
              name:
                x._id ||
                "Unknown",
              count:
                x.count
            })
          ),

        devices:
          devices.map(
            x => ({
              name:
                x._id ||
                "Unknown",
              count:
                x.count
            })
          ),

        browsers:
          browsers.map(
            x => ({
              name:
                x._id ||
                "Unknown",
              count:
                x.count
            })
          ),

        isps:
          isps.map(
            x => ({
              name:
                x._id ||
                "Unknown",
              count:
                x.count
            })
          )
      });

    } catch (error) {

      console.error(
        "STATS ERROR:",
        error
      );

      res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to load statistics."
        });
    }
  }
);


/* =========================================================
   LIVE STREAM - PASSWORD PROTECTED
========================================================= */

app.get(
  "/api/live",
  requireLiveAuth,
  (req, res) => {

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
      `event: connected\n` +
      `data: ${JSON.stringify({
        success: true,
        time:
          new Date()
      })}\n\n`
    );

    liveClients.add(res);

    req.on(
      "close",
      () => {
        liveClients.delete(res);
      }
    );
  }
);


/* =========================================================
   BROADCAST
========================================================= */

function broadcast(
  event,
  data
) {

  const payload =
    `event: ${event}\n` +
    `data: ${JSON.stringify(data)}\n\n`;

  for (
    const client of liveClients
  ) {

    try {
      client.write(payload);
    } catch {
      liveClients.delete(
        client
      );
    }
  }
}


/*
  Only authenticated live clients
  receive this event because only
  /api/live can register.
*/

const originalInsert =
  visitorsCollection;

function sendLiveVisitor(
  visitor
) {

  broadcast(
    "visitor",
    safeVisitor(visitor)
  );
}


/* =========================================================
   PROTECTED LIVE HISTORY
========================================================= */

app.get(
  "/api/live/history",
  requireLiveAuth,
  async (req, res) => {

    try {

      const records =
        await visitorsCollection
          .find({})
          .sort({
            createdAt: -1
          })
          .limit(100)
          .toArray();

      res.json({

        success: true,

        data:
          records.map(
            safeVisitor
          )
      });

    } catch {

      res
        .status(500)
        .json({
          success: false,
          message:
            "Unable to load live history."
        });
    }
  }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  async (req, res) => {

    let mongo =
      "offline";

    try {

      await db.command({
        ping: 1
      });

      mongo =
        "online";

    } catch {}

    res.json({

      success: true,

      service:
        "Rakib IP Tracker",

      version:
        "3.0.0",

      mongo,

      protectedLive:
        true,

      liveClients:
        liveClients.size,

      time:
        new Date().toISOString()
    });
  }
);


/* =========================================================
   FRONTEND
========================================================= */

app.use(
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);


/* =========================================================
   MONGO INSERT HOOK
========================================================= */

/*
  We intercept the collection insert
  so every new visitor is sent only
  to authenticated live streams.
*/

const originalInsertOne =
  visitorsCollection?.insertOne;


/* =========================================================
   START
========================================================= */

connectMongo()
  .then(() => {

    /*
      Patch insertOne after Mongo
      connection is established.
    */

    const collection =
      visitorsCollection;

    const original =
      collection.insertOne.bind(
        collection
      );

    collection.insertOne =
      async function(document, options) {

        const result =
          await original(
            document,
            options
          );

        /*
          Only authenticated
          SSE clients exist here.
        */

        broadcast(
          "visitor",
          safeVisitor(document)
        );

        return result;
      };

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log("");
        console.log(
          "╔══════════════════════════════════════╗"
        );
        console.log(
          "║     RAKIB IP INTELLIGENCE v3.0      ║"
        );
        console.log(
          "╠══════════════════════════════════════╣"
        );
        console.log(
          `║ PORT     : ${PORT}`
        );
        console.log(
          `║ DATABASE : ${DB_NAME}`
        );
        console.log(
          "║ MONGODB  : ONLINE"
        );
        console.log(
          "║ HISTORY  : PASSWORD PROTECTED"
        );
        console.log(
          "║ LIVE     : PASSWORD PROTECTED"
        );
        console.log(
          "║ RAW IP   : NOT STORED"
        );
        console.log(
          "╚══════════════════════════════════════╝"
        );
        console.log("");
      }
    );
  })
  .catch(error => {

    console.error(
      "❌ MongoDB connection failed:"
    );

    console.error(error);

    process.exit(1);
  });


/* =========================================================
   CLEANUP
========================================================= */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        ip,
        times
      ] of rateMap
    ) {

      const fresh =
        times.filter(
          t =>
            now - t <
            60000
        );

      if (fresh.length) {
        rateMap.set(
          ip,
          fresh
        );
      } else {
        rateMap.delete(
          ip
        );
      }
    }

    for (
      const [
        token,
        session
      ] of liveSessions
    ) {

      if (
        session.expiresAt <
        now
      ) {

        liveSessions.delete(
          token
        );
      }
    }

  },
  60000
);
