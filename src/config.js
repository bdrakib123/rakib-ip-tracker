"use strict";

const path = require("node:path");
const os = require("node:os");

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadConfig(env = process.env) {
  const password = required(env, "ADMIN_PASSWORD");
  if (password.length < 16) throw new Error("ADMIN_PASSWORD must be at least 16 characters");

  const encryptionKey = required(env, "IP_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error("IP_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters");
  }

  const nodeEnv = env.NODE_ENV || "development";
  const vercelMode = env.VERCEL === "1";
  const stagingMode = env.STAGING_MODE === "true";
  const stagingEphemeralStorage = env.STAGING_EPHEMERAL_STORAGE === "true";
  if (env.STAGING_MODE !== undefined && !["true", "false"].includes(env.STAGING_MODE)) {
    throw new Error("STAGING_MODE must be true or false");
  }
  if (env.STAGING_EPHEMERAL_STORAGE !== undefined && !["true", "false"].includes(env.STAGING_EPHEMERAL_STORAGE)) {
    throw new Error("STAGING_EPHEMERAL_STORAGE must be true or false");
  }
  if (vercelMode && (stagingMode || stagingEphemeralStorage || env.STORAGE_MOUNT_PATH || env.STORAGE_FILE || env.BACKUP_DIR || env.MONGODB_URI || env.STAGING_MONGODB_URI)) {
    throw new Error("Vercel mode cannot use file storage, temporary staging storage, or MongoDB configuration.");
  }
  if (stagingMode !== stagingEphemeralStorage) {
    throw new Error("STAGING_MODE and STAGING_EPHEMERAL_STORAGE must both be explicitly enabled for temporary staging storage.");
  }
  const stagingAccessPassword = stagingMode ? required(env, "STAGING_ACCESS_PASSWORD") : null;
  if (stagingMode && (stagingAccessPassword.length < 32 || stagingAccessPassword.length > 256 || /[^\x20-\x7e]/.test(stagingAccessPassword))) {
    throw new Error("STAGING_ACCESS_PASSWORD must be 32 through 256 printable ASCII characters.");
  }
  if (stagingMode && (stagingAccessPassword === password || stagingAccessPassword === encryptionKey)) {
    throw new Error("STAGING_ACCESS_PASSWORD must be distinct from the admin password and encryption key.");
  }
  let stagingStorageDir = null;
  if (stagingMode) {
    if (env.MONGODB_URI || env.STAGING_MONGODB_URI) throw new Error("MongoDB configuration must not be present in temporary staging mode.");
    if (env.TRUST_PROXY_HOPS !== undefined && env.TRUST_PROXY_HOPS !== "0") {
      throw new Error("TRUST_PROXY_HOPS must be 0 in temporary staging mode until the proxy chain is verified.");
    }
    if (env.STORAGE_MOUNT_PATH) throw new Error("STORAGE_MOUNT_PATH must not be set in temporary staging mode.");
    if (env.BACKUP_DIR) throw new Error("BACKUP_DIR must not be set in temporary staging mode; backups are disabled.");
    const configuredStagingDir = required(env, "STAGING_STORAGE_DIR");
    if (!path.isAbsolute(configuredStagingDir)) throw new Error("STAGING_STORAGE_DIR must be an absolute path inside the operating-system temporary directory.");
    const tempRoot = path.resolve(os.tmpdir());
    stagingStorageDir = path.resolve(configuredStagingDir);
    const relativeStagingDir = path.relative(tempRoot, stagingStorageDir);
    if (!relativeStagingDir || relativeStagingDir === ".." || relativeStagingDir.startsWith(`..${path.sep}`) || path.isAbsolute(relativeStagingDir)) {
      throw new Error("STAGING_STORAGE_DIR must be a dedicated child directory of the operating-system temporary directory.");
    }
    const expectedStagingFile = path.join(stagingStorageDir, "visitors.json");
    if (env.STORAGE_FILE && path.resolve(env.STORAGE_FILE) !== expectedStagingFile) {
      throw new Error("STORAGE_FILE must be omitted in temporary staging mode or match STAGING_STORAGE_DIR/visitors.json.");
    }
  }
  if (nodeEnv === "production" && !stagingMode && env.TRUST_PROXY_HOPS === undefined) {
    throw new Error("TRUST_PROXY_HOPS must be explicitly set in production after verifying the proxy chain.");
  }
  const trustProxyHops = stagingMode ? 0 : env.TRUST_PROXY_HOPS === undefined
    ? (env.RENDER ? 1 : 0)
    : Number(env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 through 10");
  }
  if (vercelMode && env.TRUST_PROXY_HOPS === undefined) {
    throw new Error("TRUST_PROXY_HOPS must be explicitly configured for Vercel after verifying the proxy chain.");
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 through 65535");
  const geoProvider = env.GEO_PROVIDER || "ipwho.is";
  if (geoProvider !== "ipwho.is") throw new Error(`Unsupported geolocation provider: ${geoProvider}`);
  const storageBackend = vercelMode ? required(env, "STORAGE_BACKEND") : (env.STORAGE_BACKEND || "json-file");
  if (vercelMode && storageBackend !== "neon-postgres") throw new Error("Vercel requires STORAGE_BACKEND=neon-postgres; file storage is not supported.");
  if (!vercelMode && storageBackend !== "json-file") throw new Error("STORAGE_BACKEND must be json-file outside Vercel.");
  const databaseUrl = vercelMode ? required(env, "DATABASE_URL") : null;
  if (databaseUrl && !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  const storageMountPath = vercelMode || stagingMode ? null : env.STORAGE_MOUNT_PATH ? path.resolve(env.STORAGE_MOUNT_PATH) : null;
  const storageFile = vercelMode ? null : stagingMode
    ? path.join(stagingStorageDir, "visitors.json")
    : path.resolve(env.STORAGE_FILE || path.join(process.cwd(), "data", "visitors.json"));
  if (nodeEnv === "production" && !vercelMode && !stagingMode && !storageMountPath) {
    throw new Error("STORAGE_MOUNT_PATH is required in production; refusing unmounted file storage.");
  }
  if (storageMountPath) {
    if (!path.isAbsolute(env.STORAGE_MOUNT_PATH)) throw new Error("STORAGE_MOUNT_PATH must be absolute.");
    const relativeStorageFile = path.relative(storageMountPath, storageFile);
    if (!relativeStorageFile || relativeStorageFile === ".." || relativeStorageFile.startsWith(`..${path.sep}`) || path.isAbsolute(relativeStorageFile)) {
      throw new Error("STORAGE_FILE must be a file strictly inside STORAGE_MOUNT_PATH.");
    }
  }

  return Object.freeze({
    nodeEnv,
    vercelMode,
    stagingMode,
    stagingEphemeralStorage,
    stagingStorageDir,
    stagingAccessPassword,
    secureCookies: nodeEnv === "production" || stagingMode,
    port,
    storageBackend,
    databaseUrl,
    storageMountPath,
    storageFile,
    adminPassword: password,
    encryptionKey,
    trustProxyHops,
    geoProvider,
    geoTimeoutMs: boundedNumber(env.GEO_TIMEOUT_MS, 5000, 500, 15000),
    geoRetryCount: boundedNumber(env.GEO_RETRY_COUNT, 1, 0, 2),
    publicRateLimit: boundedNumber(env.PUBLIC_RATE_LIMIT, 30, 5, 300),
    loginRateLimit: boundedNumber(env.LOGIN_RATE_LIMIT, 5, 2, 20)
  });
}

function boundedNumber(value, fallback, min, max) {
  const number = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid numeric configuration");
  return Math.max(min, Math.min(max, Math.floor(number)));
}

module.exports = { loadConfig };
