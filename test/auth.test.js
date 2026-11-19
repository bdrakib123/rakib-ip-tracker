"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdminAuth, isSameOrigin } = require("../src/auth/adminAuth");

function response() {
  return {
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function request(cookie, extra = {}) {
  return { headers: { cookie }, ...extra };
}

test("admin session cookies are secure in production and sessions expire and revoke", () => {
  let timestamp = 1_000_000;
  const password = "unit-test-admin-password";
  const auth = createAdminAuth({ password, production: true, now: () => timestamp });
  assert.equal(auth.authenticate(password), true);
  assert.equal(auth.authenticate("wrong-password"), false);

  const res = response();
  auth.setSession(res);
  const setCookie = res.headers["Set-Cookie"];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  const cookie = setCookie.split(";")[0];
  const req = request(cookie);
  let continued = false;
  auth.requireAdmin(req, response(), () => { continued = true; });
  assert.equal(continued, true);
  auth.clearSession(req, response());
  assert.equal(auth.isAuthenticated(req), false);

  const secondResponse = response();
  auth.setSession(secondResponse);
  const secondRequest = request(secondResponse.headers["Set-Cookie"].split(";")[0]);
  timestamp += 12 * 60 * 60 * 1000 + 1;
  const expiredResponse = response();
  continued = false;
  auth.requireAdmin(secondRequest, expiredResponse, () => { continued = true; });
  assert.equal(expiredResponse.statusCode, 401);
  assert.equal(continued, false);
  assert.equal(auth.isAuthenticated(secondRequest), false);
});

test("persistent admin sessions store only token hashes and support revocation across auth instances", async () => {
  const rows = new Map();
  const sessionStore = {
    async createAdminSession(hash, expiresAt) { rows.set(hash, expiresAt); },
    async hasAdminSession(hash) { return rows.has(hash) && rows.get(hash) > new Date(1000); },
    async revokeAdminSession(hash) { rows.delete(hash); }
  };
  const auth = createAdminAuth({ password: "persistent-unit-test-password", production: true, now: () => 1000, sessionStore });
  const res = response();
  await auth.setSession(res);
  const token = decodeURIComponent(res.headers["Set-Cookie"].split(";")[0].split("=")[1]);
  const req = request(res.headers["Set-Cookie"].split(";")[0]);
  assert.equal(rows.has(token), false);
  assert.equal([...rows.keys()][0].length, 64);
  assert.equal(await createAdminAuth({ password: "persistent-unit-test-password", sessionStore }).isAuthenticated(req), true);
  await auth.clearSession(req, response());
  assert.equal(await createAdminAuth({ password: "persistent-unit-test-password", sessionStore }).isAuthenticated(req), false);
});

test("admin write origin validation rejects cross-origin and missing fetch metadata", () => {
  const req = {
    get(name) {
      return ({ origin: "https://attacker.invalid", host: "service.example", "sec-fetch-site": undefined })[name.toLowerCase()];
    },
    secure: true
  };
  assert.equal(isSameOrigin(req), false);
  req.get = name => name.toLowerCase() === "sec-fetch-site" ? "same-origin" : undefined;
  assert.equal(isSameOrigin(req), true);
});
