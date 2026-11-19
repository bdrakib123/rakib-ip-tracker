"use strict";

function finiteInt(value, { min = 0, max = 10000 } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.floor(number) : null;
}

function shortText(value, max = 100) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  return clean ? clean.slice(0, max) : null;
}

function validateClientSignals(input = {}) {
  const screen = input.screen || {};
  const viewport = input.viewport || {};
  const connection = input.connection || {};
  return {
    screen: { width: finiteInt(screen.width), height: finiteInt(screen.height) },
    viewport: { width: finiteInt(viewport.width), height: finiteInt(viewport.height) },
    language: shortText(input.language, 35),
    languages: Array.isArray(input.languages)
      ? input.languages.slice(0, 10).map(value => shortText(value, 35)).filter(Boolean)
      : [],
    timezone: shortText(input.timezone, 60),
    platform: shortText(input.platform, 60),
    colorScheme: ["dark", "light", "no-preference"].includes(input.colorScheme) ? input.colorScheme : "unsupported",
    online: typeof input.online === "boolean" ? input.online : null,
    touchPoints: finiteInt(input.touchPoints, { min: 0, max: 100 }),
    touchSupport: typeof input.touchSupport === "boolean" ? input.touchSupport : null,
    hardwareConcurrency: finiteInt(input.hardwareConcurrency, { min: 1, max: 256 }),
    connection: {
      type: shortText(connection.type, 30),
      effectiveType: shortText(connection.effectiveType, 20),
      downlink: connection.downlink !== null && connection.downlink !== undefined && connection.downlink !== "" &&
        Number.isFinite(Number(connection.downlink)) && Number(connection.downlink) >= 0
        ? Math.min(Number(connection.downlink), 10000)
        : null,
      rtt: finiteInt(connection.rtt, { min: 0, max: 60000 }),
      saveData: typeof connection.saveData === "boolean" ? connection.saveData : null
    }
  };
}

module.exports = { validateClientSignals };
