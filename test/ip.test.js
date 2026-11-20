"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getRequestIP } = require("../src/lib/ip");

test("uses Cloudflare's validated public client IP header when a CF-Ray is present", () => {
  const req = {
    headers: { "cf-connecting-ip": "8.8.8.8", "cf-ray": "synthetic-ray-id" },
    ip: "10.30.107.62",
    socket: { remoteAddress: "10.30.0.1" }
  };
  assert.equal(getRequestIP(req), "8.8.8.8");
});

test("ignores private or invalid Cloudflare IP values", () => {
  const privateIP = {
    headers: { "cf-connecting-ip": "10.30.107.62", "cf-ray": "synthetic-ray-id" },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" }
  };
  const invalidIP = {
    headers: { "cf-connecting-ip": "not-an-ip", "cf-ray": "synthetic-ray-id" },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" }
  };
  assert.equal(getRequestIP(privateIP), "127.0.0.1");
  assert.equal(getRequestIP(invalidIP), "127.0.0.1");
});

test("does not trust CF-Connecting-IP without the Cloudflare edge marker", () => {
  const req = {
    headers: { "cf-connecting-ip": "8.8.8.8" },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" }
  };
  assert.equal(getRequestIP(req), "127.0.0.1");
});
