"use strict";

const CONFIRMATION = "I_CONFIRM_DISPOSABLE_STAGING";
const DEFAULT_DB_PREFIX = "rakib_ip_v2_staging";

function validateStagingMongoConfig(env = process.env) {
  const required = [
    "STAGING_MONGODB_URI",
    "STAGING_ADMIN_PASSWORD",
    "STAGING_IP_ENCRYPTION_KEY",
    "STAGING_CONFIRM_DISPOSABLE"
  ];
  const missing = required.filter(name => !String(env[name] || "").trim());
  if (missing.length) {
    const error = new Error(`Missing required staging environment variables: ${missing.join(", ")}`);
    error.code = "STAGING_CONFIG_MISSING";
    error.missing = missing;
    throw error;
  }

  const uri = String(env.STAGING_MONGODB_URI).trim();
  let parsed;
  try { parsed = new URL(uri); } catch {
    throw new Error("STAGING_MONGODB_URI must be a valid MongoDB connection URI; its value is redacted.");
  }
  if (!(["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error("STAGING_MONGODB_URI must use mongodb:// or mongodb+srv:// and staging-specific credentials; its value is redacted.");
  }

  const password = String(env.STAGING_ADMIN_PASSWORD);
  if (password.length < 16) throw new Error("STAGING_ADMIN_PASSWORD must be at least 16 characters.");
  const encryptionKey = String(env.STAGING_IP_ENCRYPTION_KEY);
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error("STAGING_IP_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.");
  }
  if (env.STAGING_CONFIRM_DISPOSABLE !== CONFIRMATION) {
    throw new Error(`STAGING_CONFIRM_DISPOSABLE must equal ${CONFIRMATION}.`);
  }

  const dbPrefix = String(env.STAGING_DB_PREFIX || DEFAULT_DB_PREFIX).trim();
  if (!/^[a-z][a-z0-9_-]{2,35}$/.test(dbPrefix) || !dbPrefix.startsWith("rakib_ip_v2_staging")) {
    throw new Error("STAGING_DB_PREFIX must be a safe name beginning with rakib_ip_v2_staging.");
  }

  return Object.freeze({ uri, password, encryptionKey, dbPrefix });
}

module.exports = { validateStagingMongoConfig, STAGING_CONFIRMATION: CONFIRMATION, DEFAULT_STAGING_DB_PREFIX: DEFAULT_DB_PREFIX };
