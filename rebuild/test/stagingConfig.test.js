"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateStagingMongoConfig, STAGING_CONFIRMATION } = require("../src/lib/stagingMongoConfig");

function validEnv() {
  return {
    STAGING_MONGODB_URI: "mongodb+srv://stage_user:stage_password@staging.example.invalid/?retryWrites=true&w=majority",
    STAGING_ADMIN_PASSWORD: "offline-only-staging-password",
    STAGING_IP_ENCRYPTION_KEY: "a".repeat(64),
    STAGING_CONFIRM_DISPOSABLE: STAGING_CONFIRMATION
  };
}

test("staging preflight requires explicit staging names and never falls back to MONGODB_URI", () => {
  assert.throws(() => validateStagingMongoConfig({ MONGODB_URI: "mongodb://not-read.invalid" }), error => {
    assert.equal(error.code, "STAGING_CONFIG_MISSING");
    assert.deepEqual(error.missing, ["STAGING_MONGODB_URI", "STAGING_ADMIN_PASSWORD", "STAGING_IP_ENCRYPTION_KEY", "STAGING_CONFIRM_DISPOSABLE"]);
    assert.equal(error.message.includes("not-read.invalid"), false);
    return true;
  });
});

test("staging preflight validates URI credentials, password, key, disposable confirmation, and namespace", () => {
  const valid = validateStagingMongoConfig(validEnv());
  assert.equal(valid.dbPrefix, "rakib_ip_v2_staging");

  for (const change of [
    { STAGING_MONGODB_URI: "mongodb://localhost:27017" },
    { STAGING_MONGODB_URI: "mongodb://secret:password@" },
    { STAGING_ADMIN_PASSWORD: "short" },
    { STAGING_IP_ENCRYPTION_KEY: "not-a-key" },
    { STAGING_CONFIRM_DISPOSABLE: "yes" },
    { STAGING_DB_PREFIX: "goatbot" },
    { STAGING_DB_PREFIX: "invalid/name" }
  ]) {
    assert.throws(() => validateStagingMongoConfig({ ...validEnv(), ...change }));
  }
});
