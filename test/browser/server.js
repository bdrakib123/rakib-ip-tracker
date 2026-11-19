"use strict";

// Browser-only harness: real app routes and services, in-memory synthetic storage,
// no dotenv loading and no MongoDB connection.
const { createApp } = require("../../src/app");
const { createVisitorService } = require("../../src/services/visitorService");
const { createAdminAnalytics } = require("../../src/services/adminAnalytics");
const { createGeoService } = require("../../src/geolocation/geoService");
const { createIpWhoProvider } = require("../../src/geolocation/ipwhoProvider");
const { detectDevice } = require("../../src/device/detectDevice");

const key = "0123456789abcdef".repeat(4);
const records = [];
const group = (items, keyFn) => {
  const counts = new Map();
  for (const item of items) {
    const name = keyFn(item);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};

const repository = {
  async countByIpHash(hashes) { return records.filter(item => hashes.includes(item.ipHash)).length; },
  async insert(document) {
    const saved = { ...document, _id: `browser-fixture-${records.length + 1}` };
    records.unshift(saved);
    return saved;
  },
  async history({ page = 1, limit = 50, search = "", country = "", device = "", ipSearchHashes = [] } = {}) {
    let selected = records;
    const needle = String(search || "").toLowerCase();
    if (needle) selected = selected.filter(item => ipSearchHashes.includes(item.ipHash) || [item.ipMasked, item.geo?.city, item.geo?.country, item.device?.model].some(value => String(value || "").toLowerCase().includes(needle)));
    if (country) selected = selected.filter(item => item.geo?.country === country);
    if (device) selected = selected.filter(item => item.device?.category === device);
    const total = selected.length;
    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    return { page: currentPage, limit: pageLimit, total, pages: Math.max(1, Math.ceil(total / pageLimit)), data: selected.slice((currentPage - 1) * pageLimit, currentPage * pageLimit) };
  },
  async findById(id) { return records.find(item => String(item._id) === id) || null; },
  async overview() {
    const lastDay = Date.now() - 24 * 60 * 60 * 1000;
    return {
      totalVisitors: records.length,
      last24h: records.filter(item => new Date(item.createdAt).getTime() >= lastDay).length,
      countries: group(records, item => item.geo?.country),
      devices: group(records, item => item.device?.category),
      browsers: group(records, item => item.browser?.name),
      operatingSystems: group(records, item => item.os?.name),
      daily: []
    };
  },
  async ping() { throw new Error("No database configured in browser harness"); }
};

const geoService = createGeoService({ provider: createIpWhoProvider(), timeoutMs: 8000, retryCount: 0 });
const visitorService = createVisitorService({
  repository,
  geoService,
  detectDevice,
  encryptionKey: key,
  logger: { warn() {}, error() {} }
});
const app = createApp({
  config: {
    adminPassword: "browser-only-admin-password-2026",
    nodeEnv: "test",
    trustProxyHops: 1,
    publicRateLimit: 100,
    loginRateLimit: 10
  },
  repository,
  visitorService,
  geoService,
  analytics: createAdminAnalytics({ repository, geoService, encryptionKey: key }),
  logger: { warn() {}, error() {}, info() {} }
});

const server = app.listen(4173, "127.0.0.1");
server.on("listening", () => process.stdout.write("Browser harness listening on 127.0.0.1:4173 (in-memory fixtures only)\n"));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
