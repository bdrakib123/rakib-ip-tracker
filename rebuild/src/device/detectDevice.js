"use strict";

const UAParser = require("ua-parser-js");

function categoryFromUA(ua) {
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobile|android|iphone|ipod/i.test(ua)) return "mobile";
  if (/windows|macintosh|mac os|linux|x11|cros/i.test(ua)) return "desktop";
  return "unknown";
}

function detectDevice(userAgent, Parser = UAParser) {
  const ua = String(userAgent || "").slice(0, 1000);
  let result = {};
  try {
    result = new Parser(ua).getResult() || {};
  } catch {
    return {
      device: { category: categoryFromUA(ua), brand: null, model: null, status: "partial" },
      os: { name: null, version: null, status: "unavailable" },
      browser: { name: null, version: null, status: "unavailable" },
      engine: { name: null, version: null, status: "unavailable" }
    };
  }

  let model = result.device?.model || null;
  if (/^(unknown|generic smartphone|smartphone|mobile|k|a)$/i.test(model || "")) model = null;
  let brand = result.device?.vendor || null;
  if (/^(unknown|generic)$/i.test(brand || "")) brand = null;
  if (!model) {
    const candidate = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build[\/;]|[;)])/i)?.[1]?.trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 80 &&
      !/^(Linux|Android|Mobile|wv|Build|K|A)$/i.test(candidate)) model = candidate;
  }
  // UA parsers may return a generic placeholder for reduced or unfamiliar
  // Android identifiers. Avoid presenting that placeholder as a model.
  if (!brand && model && /^\d{4,}[a-z0-9]*$/i.test(model)) model = null;
  if (!brand && model) {
    const modelLower = model.toLowerCase();
    if (/xiaomi|redmi|poco/i.test(modelLower)) brand = "Xiaomi";
    else if (/samsung|galaxy|^sm-/i.test(modelLower)) brand = "Samsung";
    else if (/pixel/i.test(modelLower)) brand = "Google";
    else if (/^iphone|^ipad/i.test(modelLower)) brand = "Apple";
  }
  const osName = result.os?.name || null;
  const browserName = result.browser?.name || null;
  const deviceCategory = result.device?.type || categoryFromUA(ua);
  return {
    device: {
      category: deviceCategory,
      brand,
      model,
      status: model || brand ? "available" : "partial"
    },
    os: { name: osName, version: result.os?.version || null, status: osName ? "available" : "unavailable" },
    browser: { name: browserName, version: result.browser?.version || null, status: browserName ? "available" : "unavailable" },
    engine: { name: result.engine?.name || null, version: result.engine?.version || null, status: result.engine?.name ? "available" : "unavailable" }
  };
}

module.exports = { detectDevice };
