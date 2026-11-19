"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("V3 has one root manifest, lockfile, and startup entry with no nested rebuild", () => {
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
  assert.equal(fs.existsSync(path.join(root, "server.js")), false);
  assert.equal("mongodb" in manifest.dependencies, false);
  assert.equal("mongodb" in (manifest.devDependencies || {}), false);
});

test("Render blueprint points at the root JSON app with persistent single-instance settings", () => {
  const blueprint = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  assert.match(blueprint, /name: privacy-safe-ip-tracker\n/);
  assert.doesNotMatch(blueprint, /^\s+plan:/m);
  assert.doesNotMatch(blueprint, /^\s+sizeGB:/m);
  assert.doesNotMatch(blueprint, /^\s+rootDir:/m);
  assert.match(blueprint, /buildCommand: npm ci --omit=dev/);
  assert.match(blueprint, /startCommand: npm start/);
  assert.match(blueprint, /numInstances: 1/);
  assert.match(blueprint, /healthCheckPath: \/healthz/);
  assert.match(blueprint, /mountPath: \/var\/data/);
  assert.match(blueprint, /STORAGE_FILE/);
});

test("separate Free staging blueprint explicitly uses guarded ephemeral storage without changing production blueprint", () => {
  const productionBlueprint = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  const stagingBlueprint = fs.readFileSync(path.join(root, "render-free-staging.yaml"), "utf8");

  assert.match(stagingBlueprint, /name: rakib-ip-tracker-free-staging/);
  assert.match(stagingBlueprint, /plan: free/);
  assert.match(stagingBlueprint, /buildCommand: npm ci --omit=dev/);
  assert.match(stagingBlueprint, /startCommand: npm start/);
  assert.match(stagingBlueprint, /numInstances: 1/);
  assert.match(stagingBlueprint, /healthCheckPath: \/healthz/);
  assert.match(stagingBlueprint, /key: STAGING_MODE\n\s+value: "true"/);
  assert.match(stagingBlueprint, /key: STAGING_EPHEMERAL_STORAGE\n\s+value: "true"/);
  assert.match(stagingBlueprint, /key: STAGING_STORAGE_DIR\n\s+value: \/tmp\/rakib-ip-tracker-staging/);
  assert.match(stagingBlueprint, /key: TRUST_PROXY_HOPS\n\s+value: "0"/);
  for (const secretName of ["ADMIN_PASSWORD", "IP_ENCRYPTION_KEY", "STAGING_ACCESS_PASSWORD"]) {
    assert.match(stagingBlueprint, new RegExp(`key: ${secretName}\\n\\s+sync: false`));
  }
  assert.doesNotMatch(stagingBlueprint, /STORAGE_MOUNT_PATH|STORAGE_FILE|BACKUP_DIR|MONGODB_URI|disk:/);

  assert.match(productionBlueprint, /mountPath: \/var\/data/);
  assert.match(productionBlueprint, /STORAGE_MOUNT_PATH/);
  assert.match(productionBlueprint, /BACKUP_DIR/);
  assert.doesNotMatch(productionBlueprint, /STAGING_MODE/);
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
