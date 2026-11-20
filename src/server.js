"use strict";

require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });

const { loadConfig } = require("./config");
const { createApp } = require("./app");
const { createGeoProvider } = require("./geolocation/ipwhoProvider");
const { createGeoService } = require("./geolocation/geoService");
const { detectDevice } = require("./device/detectDevice");
const { createStorageRepository } = require("./db/storage");
const { createVisitorService } = require("./services/visitorService");
const { createAdminAnalytics } = require("./services/adminAnalytics");
const { createLogger } = require("./lib/log");

async function start({ env = process.env, logger = createLogger(), listenPort, listenHost = "0.0.0.0" } = {}) {
  const config = loadConfig(env);
  if (config.vercelMode) {
    const error = new Error("Vercel requests must use the exported Express application entry point.");
    error.code = "VERCEL_LISTENER_DISABLED";
    throw error;
  }
  const repository = await createStorageRepository(config);
  const provider = createGeoProvider(config.geoProvider);
  const geoService = createGeoService({
    provider,
    timeoutMs: config.geoTimeoutMs,
    retryCount: config.geoRetryCount
  });
  const visitorService = createVisitorService({
    repository,
    geoService,
    detectDevice,
    encryptionKey: config.encryptionKey,
    logger
  });
  const analytics = createAdminAnalytics({ repository, geoService, encryptionKey: config.encryptionKey });
  await analytics.ready;
  const app = createApp({ config, repository, visitorService, geoService, analytics, logger });
  const port = listenPort === undefined ? config.port : listenPort;
  const server = app.listen(port, listenHost);
  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    await repository.close();
    throw error;
  }
  logger.info("server_started", { status: server.address().port });

  const shutdown = signal => {
    logger.info("server_stopping", { code: signal });
    app.locals.closeAdminStreams?.();
    server.close(async () => {
      let shutdownFailed = false;
      try { await analytics.close(); } catch (error) {
        shutdownFailed = true;
        logger.error?.("analytics_flush_failed", { code: typeof error?.code === "string" ? error.code : "STORAGE_ERROR" });
      }
      try { await repository.close(); } catch (error) {
        shutdownFailed = true;
        logger.error?.("storage_close_failed", { code: typeof error?.code === "string" ? error.code : "STORAGE_ERROR" });
      }
      process.exit(shutdownFailed ? 1 : 0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return { app, server, repository, geoService };
}

if (require.main === module) {
  start().catch(error => {
    const code = typeof error?.code === "string" && /^(?:STORAGE|DATABASE)_[A-Z_]+$/.test(error.code)
      ? error.code
      : error && typeof error.message === "string" && error.message.startsWith("Missing required environment variable:")
        ? error.message.slice("Missing required environment variable: ".length)
        : "startup_failed";
    console.error(JSON.stringify({ level: "error", event: "startup_failed", code }));
    process.exitCode = 1;
  });
}

module.exports = { start };
