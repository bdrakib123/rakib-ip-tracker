"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

function validEnv() {
  return {
    NODE_ENV: "test", PORT: "3000", STORAGE_BACKEND: "json-file", STORAGE_FILE: "./tmp/visitors.json",
    ADMIN_PASSWORD: "this-is-a-test-admin-password", IP_ENCRYPTION_KEY: "a".repeat(64)
  };
}

test("loads isolated config with bounded proxy and provider settings", () => {
  const config = loadConfig({ ...validEnv(), TRUST_PROXY_HOPS: "1", GEO_TIMEOUT_MS: "8000", GEO_RETRY_COUNT: "2" });
  assert.equal(config.port, 3000);
  assert.equal(config.trustProxyHops, 1);
  assert.equal(config.geoTimeoutMs, 8000);
  assert.equal(config.geoRetryCount, 2);
  assert.equal(config.storageBackend, "json-file");
  assert.match(config.storageFile, /visitors\.json$/);
  assert.equal("mongoUri" in config, false);
  assert.equal("mongoDb" in config, false);
});

test("rejects weak secrets, unsafe proxy values, unsupported storage backends and unknown providers", () => {
  assert.throws(() => loadConfig({ ...validEnv(), ADMIN_PASSWORD: "short" }), /at least 16/);
  assert.throws(() => loadConfig({ ...validEnv(), IP_ENCRYPTION_KEY: "not-a-key" }), /64 hexadecimal/);
  assert.throws(() => loadConfig({ ...validEnv(), TRUST_PROXY_HOPS: "true" }), /integer from 0 through 10/);
  assert.throws(() => loadConfig({ ...validEnv(), STORAGE_BACKEND: "mongodb" }), /must be json-file/);
  assert.throws(() => loadConfig({ ...validEnv(), GEO_PROVIDER: "unknown-provider" }), /Unsupported geolocation provider/);
});

test("normal V3 config starts without database variables and ignores retired Mongo variables", () => {
  const env = validEnv();
  delete env.MONGODB_URI;
  delete env.STORAGE_BACKEND;
  delete env.STORAGE_FILE;
  const config = loadConfig({ ...env, MONGODB_URI: "not-used-and-not-parsed" });
  assert.equal(config.storageBackend, "json-file");
  assert.match(config.storageFile, /data[\\/]visitors\.json$/);
  assert.equal("mongoUri" in config, false);
});

test("production config requires an explicit proxy count and persistent mount", () => {
  const env = { ...validEnv(), NODE_ENV: "production", TRUST_PROXY_HOPS: "1", STORAGE_MOUNT_PATH: "/var/data", STORAGE_FILE: "/var/data/visitors.json" };
  const config = loadConfig(env);
  assert.equal(config.storageMountPath, "/var/data");
  assert.equal(config.storageFile, "/var/data/visitors.json");
  const missingMount = { ...env };
  delete missingMount.STORAGE_MOUNT_PATH;
  assert.throws(() => loadConfig(missingMount), /STORAGE_MOUNT_PATH is required in production/);
  const missingProxy = { ...env };
  delete missingProxy.TRUST_PROXY_HOPS;
  assert.throws(() => loadConfig(missingProxy), /must be explicitly set in production/);
  assert.throws(() => loadConfig({ ...env, STORAGE_FILE: "/tmp/visitors.json" }), /strictly inside STORAGE_MOUNT_PATH/);
  assert.throws(() => loadConfig({ ...env, STORAGE_FILE: "/var/data" }), /strictly inside STORAGE_MOUNT_PATH/);
});

test("temporary staging requires both explicit flags, a staging-only password, temp path, and zero proxy trust", () => {
  const base = {
    ...validEnv(), NODE_ENV: "production", TRUST_PROXY_HOPS: "0",
    STAGING_MODE: "true", STAGING_EPHEMERAL_STORAGE: "true",
    STAGING_ACCESS_PASSWORD: "staging-only-password-which-is-long-enough-123",
    STAGING_STORAGE_DIR: require("node:path").join(require("node:os").tmpdir(), "rakib-ip-test-staging")
  };
  delete base.STORAGE_FILE;
  const config = loadConfig(base);
  assert.equal(config.stagingMode, true);
  assert.equal(config.stagingEphemeralStorage, true);
  assert.equal(config.secureCookies, true);
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.storageMountPath, null);
  assert.equal(config.storageFile, require("node:path").join(base.STAGING_STORAGE_DIR, "visitors.json"));
  for (const changes of [
    { STAGING_MODE: "false" },
    { STAGING_EPHEMERAL_STORAGE: "false" },
    { STAGING_ACCESS_PASSWORD: "short" },
    { STAGING_STORAGE_DIR: "/var/data/staging" },
    { STORAGE_MOUNT_PATH: "/var/data" },
    { BACKUP_DIR: "/var/data/backups" },
    { MONGODB_URI: "synthetic-unused-value" },
    { STORAGE_FILE: "/var/data/visitors.json" },
    { TRUST_PROXY_HOPS: "1" }
  ]) assert.throws(() => loadConfig({ ...base, ...changes }));
  const missingAccessPassword = { ...base };
  delete missingAccessPassword.STAGING_ACCESS_PASSWORD;
  assert.throws(() => loadConfig(missingAccessPassword), /STAGING_ACCESS_PASSWORD/);
  const missingDirectory = { ...base };
  delete missingDirectory.STAGING_STORAGE_DIR;
  assert.throws(() => loadConfig(missingDirectory), /STAGING_STORAGE_DIR/);
});

test("normal production cannot opt into temporary storage with only one staging flag", () => {
  const env = { ...validEnv(), NODE_ENV: "production", TRUST_PROXY_HOPS: "0", STAGING_EPHEMERAL_STORAGE: "true" };
  assert.throws(() => loadConfig(env), /both be explicitly enabled/);
});

test("Vercel production requires Neon storage, DATABASE_URL, and an explicitly reviewed proxy hop count", () => {
  const env = { ...validEnv(), NODE_ENV: "production", VERCEL: "1", STORAGE_BACKEND: "neon-postgres", DATABASE_URL: "postgresql://synthetic.invalid/db", TRUST_PROXY_HOPS: "0" };
  delete env.STORAGE_FILE;
  const config = loadConfig(env);
  assert.equal(config.vercelMode, true);
  assert.equal(config.storageBackend, "neon-postgres");
  assert.equal(config.databaseUrl, env.DATABASE_URL);
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.storageFile, null);
  assert.equal(config.storageMountPath, null);
  const missingBackend = { ...env }; delete missingBackend.STORAGE_BACKEND;
  assert.throws(() => loadConfig(missingBackend), /STORAGE_BACKEND/);
  const missingDatabase = { ...env }; delete missingDatabase.DATABASE_URL;
  assert.throws(() => loadConfig(missingDatabase), /DATABASE_URL/);
  const malformedDatabase = { ...env, DATABASE_URL: "not-a-database-url" };
  assert.throws(() => loadConfig(malformedDatabase), /PostgreSQL connection URL/);
  const missingProxy = { ...env }; delete missingProxy.TRUST_PROXY_HOPS;
  assert.throws(() => loadConfig(missingProxy), /TRUST_PROXY_HOPS/);
  assert.throws(() => loadConfig({ ...env, TRUST_PROXY_HOPS: "not-an-integer" }), /TRUST_PROXY_HOPS/);
  assert.throws(() => loadConfig({ ...env, STORAGE_BACKEND: "json-file" }), /Vercel requires STORAGE_BACKEND/);
  assert.throws(() => loadConfig({ ...env, STORAGE_BACKEND: "unconfigured-backend" }), /Vercel requires STORAGE_BACKEND/);
  assert.throws(() => loadConfig({ ...env, STORAGE_FILE: "/tmp/visitors.json" }), /cannot use file storage/);
  assert.throws(() => loadConfig({ ...env, STAGING_MODE: "true", STAGING_EPHEMERAL_STORAGE: "true" }), /cannot use file storage/);
});

test("Render production can explicitly use Neon without file storage while JSON production still requires its mount", () => {
  const env = {
    ...validEnv(), NODE_ENV: "production", TRUST_PROXY_HOPS: "1",
    STORAGE_BACKEND: "neon-postgres", DATABASE_URL: "postgresql://synthetic.invalid/render"
  };
  delete env.STORAGE_FILE;
  const config = loadConfig(env);
  assert.equal(config.vercelMode, false);
  assert.equal(config.storageBackend, "neon-postgres");
  assert.equal(config.databaseUrl, env.DATABASE_URL);
  assert.equal(config.storageMountPath, null);
  assert.equal(config.storageFile, null);

  const missingUrl = { ...env }; delete missingUrl.DATABASE_URL;
  assert.throws(() => loadConfig(missingUrl), /DATABASE_URL/);
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: "not-a-postgres-url" }), /PostgreSQL connection URL/);
  assert.throws(() => loadConfig({ ...env, STORAGE_MOUNT_PATH: "/var/data" }), /cannot use JSON file/);
  assert.throws(() => loadConfig({ ...env, BACKUP_DIR: "/var/data/backups" }), /cannot use JSON file/);
  assert.throws(() => loadConfig({ ...env, STORAGE_FILE: "/var/data/visitors.json" }), /cannot use JSON file/);
  assert.throws(() => loadConfig({ ...env, STORAGE_BACKEND: "unknown" }), /json-file or neon-postgres/);

  const staging = {
    ...env, TRUST_PROXY_HOPS: "0", STAGING_MODE: "true", STAGING_EPHEMERAL_STORAGE: "true",
    STAGING_ACCESS_PASSWORD: "staging-only-password-that-is-long-enough-123",
    STAGING_STORAGE_DIR: require("node:path").join(require("node:os").tmpdir(), "rakib-ip-config-staging")
  };
  assert.throws(() => loadConfig(staging), /requires STORAGE_BACKEND=json-file/);
});
