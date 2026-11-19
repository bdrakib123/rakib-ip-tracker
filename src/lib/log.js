"use strict";

function createLogger(output = console) {
  return {
    info(event, details = {}) {
      output.info(JSON.stringify({ level: "info", event, ...safeDetails(details) }));
    },
    warn(event, details = {}) {
      output.warn(JSON.stringify({ level: "warn", event, ...safeDetails(details) }));
    },
    error(event, details = {}) {
      output.error(JSON.stringify({ level: "error", event, ...safeDetails(details) }));
    }
  };
}

function safeDetails(details) {
  const allowed = ["code", "status", "route", "durationMs", "count"];
  return Object.fromEntries(allowed.filter(key => details[key] !== undefined).map(key => [key, details[key]]));
}

module.exports = { createLogger };
