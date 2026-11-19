"use strict";

const { loadConfig } = require("./config");
const { createApp } = require("./app");
const { createGeoProvider } = require("./geolocation/ipwhoProvider");
const { createGeoService } = require("./geolocation/geoService");
const { detectDevice } = require("./device/detectDevice");
const { createStorageRepository } = require("./db/storage");
const { createVisitorService } = require("./services/visitorService");
const { createAdminAnalytics } = require("./services/adminAnalytics");
const { createLogger } = require("./lib/log");

async function createVercelApplication({ env = process.env, logger = createLogger(), waitUntil, repositoryFactory = createStorageRepository, appFactory = createApp } = {}) {
  const config = loadConfig(env);
  if (!config.vercelMode) {
    const error = new Error("The Vercel Function entry requires the Vercel runtime.");
    error.code = "VERCEL_RUNTIME_REQUIRED";
    throw error;
  }
  const repository = await repositoryFactory(config);
  const geoService = createGeoService({
    provider: createGeoProvider(config.geoProvider),
    timeoutMs: config.geoTimeoutMs,
    retryCount: config.geoRetryCount
  });
  const visitorService = createVisitorService({ repository, geoService, detectDevice, encryptionKey: config.encryptionKey, logger });
  const analytics = createAdminAnalytics({ repository, geoService, encryptionKey: config.encryptionKey });
  await analytics.ready;
  return appFactory({ config, repository, visitorService, geoService, analytics, logger, waitUntil });
}

module.exports = { createVercelApplication };
