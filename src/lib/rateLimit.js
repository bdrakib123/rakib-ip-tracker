"use strict";

const crypto = require("node:crypto");

function createRateLimiter({ windowMs, max, now = Date.now, maxEntries = 5000, cleanupEvery = 256 }) {
  if (!Number.isInteger(windowMs) || windowMs < 1 || !Number.isInteger(max) || max < 1 ||
      !Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(cleanupEvery) || cleanupEvery < 1) {
    throw new TypeError("Rate limiter requires positive integer limits.");
  }
  const buckets = new Map();
  let requestsSinceCleanup = 0;
  return function rateLimit(req, res, next) {
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const key = crypto.createHash("sha256").update(ip).digest("hex");
    const timestamp = now();
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= cleanupEvery) {
      requestsSinceCleanup = 0;
      for (const [entryKey, value] of buckets) {
        if (value.resetAt <= timestamp) buckets.delete(entryKey);
      }
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= timestamp) {
      if (bucket) buckets.delete(key);
      if (buckets.size >= maxEntries) buckets.delete(buckets.keys().next().value);
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(key, bucket);
    } else {
      // Keep the map bounded while retaining recently active clients.
      buckets.delete(key);
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - timestamp) / 1000)));
      return res.status(429).json({ success: false, error: { code: "RATE_LIMITED", message: "Please wait before trying again." } });
    }
    next();
  };
}

module.exports = { createRateLimiter };
