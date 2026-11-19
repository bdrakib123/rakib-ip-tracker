"use strict";

const express = require("express");
const { createVercelApplication } = require("./vercelApplication");
const { createLogger } = require("./lib/log");
const { waitUntil } = require("@vercel/functions");

const logger = createLogger();
const functionApp = express();
let initialization;

function getApplication() {
  if (!initialization) {
    initialization = createVercelApplication({ waitUntil, logger }).catch(error => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

functionApp.use((req, res, next) => {
  getApplication().then(app => app.handle(req, res, next)).catch(error => {
    logger.error("vercel_initialization_failed", { code: typeof error?.code === "string" ? error.code : "APPLICATION_INITIALIZATION_FAILED" });
    if (res.headersSent) return res.end();
    res.status(503).json({
      success: false,
      error: { code: error?.code || "SERVICE_UNAVAILABLE", message: "The service is temporarily unavailable." }
    });
  });
});

module.exports = functionApp;
