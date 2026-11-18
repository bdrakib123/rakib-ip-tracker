"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../src/lib/rateLimit");

function invoke(limiter, ip) {
  const response = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let continued = false;
  limiter({ ip, socket: { remoteAddress: ip } }, response, () => { continued = true; });
  return { response, continued };
}

test("rate limiter keeps active-client buckets bounded and expires old buckets", () => {
  let timestamp = 1000;
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, maxEntries: 2, cleanupEvery: 2, now: () => timestamp });
  assert.equal(invoke(limiter, "198.51.100.1").continued, true);
  assert.equal(invoke(limiter, "198.51.100.2").continued, true);
  assert.equal(invoke(limiter, "198.51.100.1").response.statusCode, 429);
  // At capacity, a new source evicts the least recently active bucket, bounding memory.
  assert.equal(invoke(limiter, "198.51.100.3").continued, true);
  assert.equal(invoke(limiter, "198.51.100.3").response.statusCode, 429);
  timestamp += 1001;
  assert.equal(invoke(limiter, "198.51.100.4").continued, true);
  assert.equal(invoke(limiter, "198.51.100.4").response.statusCode, 429);
});

test("rate limiter rejects invalid internal bounds", () => {
  assert.throws(() => createRateLimiter({ windowMs: 0, max: 1 }), /positive integer/);
  assert.throws(() => createRateLimiter({ windowMs: 10, max: 1, maxEntries: 0 }), /positive integer/);
});
