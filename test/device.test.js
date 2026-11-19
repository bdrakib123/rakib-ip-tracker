"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { detectDevice } = require("../src/device/detectDevice");

const agents = [
  ["Redmi 10C", "Mozilla/5.0 (Linux; Android 11; Redmi 10C Build/RP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile", /Redmi 10C/i],
  ["Redmi model code", "Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile", /23021RAA2Y/i],
  ["Samsung Galaxy", "Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile", /SM-S921B/i],
  ["Google Pixel", "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "mobile", /Pixel 8 Pro/i],
  ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "mobile", /iPhone/i],
  ["iPad", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "tablet", /iPad/i],
  ["Windows desktop", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "desktop", null],
  ["Linux desktop", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "desktop", null],
  ["macOS desktop", "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "desktop", null],
  ["Android tablet", "Mozilla/5.0 (Linux; Android 13; SM-X700 Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "tablet", /SM-X700/i]
];

test("recognizes device category, OS and browser for realistic User-Agent examples", () => {
  for (const [label, ua, category, modelPattern] of agents) {
    const result = detectDevice(ua);
    assert.equal(result.device.category, category, `${label} category`);
    assert.equal(result.os.status, "available", `${label} OS`);
    assert.equal(result.browser.status, "available", `${label} browser`);
    if (modelPattern) assert.match(result.device.model, modelPattern, `${label} model`);
  }
});

test("does not claim a model from Chrome's reduced Android placeholder", () => {
  const result = detectDevice("Mozilla/5.0 (Linux; Android 13; K Build/ABC) Mobile Chrome/120.0");
  assert.equal(result.device.model, null);
  assert.equal(result.device.category, "mobile");
});

test("does not infer a manufacturer from an unfamiliar numeric Android model code", () => {
  const result = detectDevice("Mozilla/5.0 (Linux; Android 13; 99999ZZZ Build/TKQ1) Mobile Chrome/120.0");
  assert.equal(result.device.model, null);
  assert.equal(result.device.brand, null);
  assert.equal(result.device.category, "mobile");
});

test("parser exceptions keep category fallback and do not throw", () => {
  class BrokenParser { constructor() { throw new Error("parser test failure"); } }
  const result = detectDevice("Android 14", BrokenParser);
  assert.equal(result.device.category, "mobile");
  assert.equal(result.device.model, null);
  assert.equal(result.browser.status, "unavailable");
});
