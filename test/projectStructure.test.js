"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("V3 has one root manifest, lockfile, and Render startup entry", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(manifest.name, "rakib-ip-tracker");
  assert.equal(manifest.version, "3.0.0");
  assert.equal(manifest.main, "src/server.js");
  assert.equal(manifest.scripts.start, "node src/server.js");
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[""].version, manifest.version);
  assert.equal(fs.existsSync(path.join(root, "rebuild")), false);
  assert.equal(fs.existsSync(path.join(root, "src", "server.js")), true);
  assert.equal("mongodb" in manifest.dependencies, false);
  assert.equal("mongodb" in (manifest.devDependencies || {}), false);
});

test("Render dashboard deployment settings remain documented and application assets are present", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const guide = fs.readFileSync(path.join(root, "docs", "DEPLOYMENT_GUIDE.md"), "utf8");
  assert.equal(manifest.scripts.start, "node src/server.js");
  assert.match(guide, /npm ci --omit=dev/);
  assert.match(guide, /npm start/);
  assert.match(guide, /\/healthz/);
  assert.match(guide, /Render Dashboard/);
  assert.equal(fs.existsSync(path.join(root, "public", "index.html")), true);
  assert.equal(fs.existsSync(path.join(root, "public", "admin.html")), true);
});

test("Express CSP allows the required exact OpenStreetMap tile hosts", () => {
  const appSource = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  const appPolicy = appSource.match(/setHeader\("Content-Security-Policy", "([^"]+)"\)/)?.[1];
  assert.ok(appPolicy);
  assert.match(appPolicy, /img-src 'self' data: https:\/\/tile\.openstreetmap\.org https:\/\/\*\.tile\.openstreetmap\.org/);
  assert.doesNotMatch(appPolicy, /https:\/\/\*\.openstreetmap\.org/);
  assert.match(appPolicy, /script-src 'self' https:\/\/unpkg\.com/);
});

test("admin telemetry UI consumes the top-level analytics contracts and displays their counts", () => {
  const admin = fs.readFileSync(path.join(root, "public", "admin.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
  assert.match(admin, /apiPayload\("\/api\/analytics\/sessions\?limit=8"\)/);
  assert.match(admin, /apiPayload\("\/api\/analytics\/security"\)/);
  assert.match(admin, /apiPayload\("\/api\/analytics\/overview"\)/);
  assert.match(admin, /apiPayload\("\/api\/analytics\/session\/"/);
  assert.match(admin, /overview\.last24h\?\.securityEvents/);
  assert.match(html, /id="analytics-summary"/);
});
