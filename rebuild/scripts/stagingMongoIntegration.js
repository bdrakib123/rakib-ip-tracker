"use strict";

const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { validateStagingMongoConfig } = require("../src/lib/stagingMongoConfig");

function reportBlocked(error) {
  const missing = Array.isArray(error.missing) ? error.missing : [];
  process.stderr.write(`${JSON.stringify({ result: "BLOCKED", code: error.code || "STAGING_CONFIG_INVALID", missing, message: error.message })}\n`);
  process.exitCode = 2;
}

let stagingConfig;
try {
  stagingConfig = validateStagingMongoConfig(process.env);
} catch (error) {
  reportBlocked(error);
  return;
}

if (process.argv.includes("--check")) {
  process.stdout.write("Staging configuration is present and valid. No database connection was attempted.\n");
  return;
}

const { connectMongo, MongoVisitorRepository } = require("../src/db/mongoRepository");
const { createVisitorService, decryptIP } = require("../src/services/visitorService");
const { createApp } = require("../src/app");
const { createAdminAnalytics } = require("../src/services/adminAnalytics");
const { detectDevice } = require("../src/device/detectDevice");

const fields = values => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, {
  value,
  status: value === null ? "unavailable" : "available"
}]));
const syntheticGeo = {
  status: "partial",
  precision: "approximate",
  source: "synthetic staging fixture",
  errorCode: null,
  fields: fields({
    country: "Staging Fixtureland", countryCode: "SF", region: "Synthetic Region", city: "Fixture City",
    postal: null, timezone: "Etc/UTC", isp: "Synthetic ISP", organization: "Synthetic Org",
    asn: "AS64500", latitude: 12.5, longitude: 45.5
  })
};
const logger = { warn() {}, error() {}, info() {} };
let activeNamespace = null;

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

async function run() {
  const runId = `${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
  const dbName = `${stagingConfig.dbPrefix}_${runId}`;
  const collectionName = `visitors_${runId}`;
  activeNamespace = { database: dbName, collection: collectionName };
  let client;
  let server;
  let reconnectedClient;
  try {
    ({ client } = await connectMongo({ uri: stagingConfig.uri, dbName, collectionName }));
    const db = client.db(dbName);
    const repository = new MongoVisitorRepository(db.collection(collectionName), db);
    await repository.ping();

    const indexes = await repository.collection.indexes();
    assert.ok(indexes.some(index => index.name === "createdAt_-1"), "createdAt index exists");
    assert.ok(indexes.some(index => index.name === "ipHash_1_createdAt_-1"), "ipHash compound index exists");

    const emptyHistory = await repository.history({ page: 1, limit: 10 });
    const emptyOverview = await repository.overview();
    assert.equal(emptyHistory.total, 0, "new test collection starts empty");
    assert.equal(emptyOverview.totalVisitors, 0, "empty overview has zero records");

    const visitorService = createVisitorService({
      repository,
      geoService: { lookup: async () => structuredClone(syntheticGeo) },
      detectDevice,
      encryptionKey: stagingConfig.encryptionKey,
      logger
    });
    const req = {
      ip: "8.8.8.8",
      socket: { remoteAddress: "127.0.0.1" },
      get: name => name.toLowerCase() === "user-agent"
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        : ""
    };
    const created = await visitorService.record(req, { language: "en-US", timezone: "Etc/UTC", screen: { width: 1280, height: 800 } });
    const inserted = await repository.findById(created.id);
    assert.ok(inserted?.ipEncrypted, "IP is encrypted at rest");
    assert.equal(inserted.ip, undefined, "plaintext IP is not stored");
    assert.equal(inserted.ipMasked, "8.8.8.xxx", "IP masking is persisted");
    assert.equal(decryptIP(inserted.ipEncrypted, stagingConfig.encryptionKey), "8.8.8.8", "staging key decrypts inserted fixture");

    const legacy = await repository.insert({
      ipMasked: "203.0.113.xxx",
      geo: { country: "Legacy Fixtureland", country_code: "LF", regionName: "Legacy Region", city: "Legacy City", provider: "Legacy ISP", org: "Legacy Org", as: "AS64501", lat: 10, lon: 20 },
      device: { type: "mobile", vendor: "Synthetic Legacy Brand", model: "Synthetic Legacy Model" },
      browser: { name: "Synthetic Browser", version: "1" },
      os: { name: "Synthetic OS", version: "1" },
      createdAt: new Date(Date.now() - 1000)
    });

    const pageOne = await repository.history({ page: 1, limit: 1 });
    const pageTwo = await repository.history({ page: 2, limit: 1 });
    assert.equal(pageOne.total, 2, "history total includes both test records");
    assert.equal(pageOne.pages, 2, "pagination page count is correct");
    assert.equal(pageOne.data.length, 1);
    assert.equal(pageTwo.data.length, 1);

    const geoService = { health: () => ({ provider: "synthetic fixture", state: "not_checked", lastCheckedAt: null, lastErrorCode: null }) };
    const app = createApp({
      config: { adminPassword: stagingConfig.password, nodeEnv: "test", trustProxyHops: 0, publicRateLimit: 100, loginRateLimit: 10 },
      repository,
      visitorService,
      geoService,
      analytics: createAdminAnalytics({ repository, geoService }),
      logger
    });
    server = await listen(app);
    const origin = `http://127.0.0.1:${server.address().port}`;

    const denied = await fetch(`${origin}/api/admin/history`);
    assert.equal(denied.status, 401, "admin history denied before login");
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: stagingConfig.password })
    });
    assert.equal(login.status, 200, "staging admin login accepted");
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const adminResponse = await fetch(`${origin}/api/admin/history?search=8.8.8.8`, { headers: { Cookie: cookie } });
    assert.equal(adminResponse.status, 200);
    const adminPayload = await adminResponse.json();
    assert.equal(adminPayload.data.total, 1, "exact IP admin search finds encrypted record by hash");
    assert.equal(adminPayload.data.data[0].ip, "8.8.8.8", "admin sees its authorized test record");

    const legacyResponse = await fetch(`${origin}/api/admin/history?search=Legacy%20Synthetic%20Model`, { headers: { Cookie: cookie } });
    const legacyPayload = await legacyResponse.json();
    assert.equal(legacyPayload.data.total, 1, "synthetic legacy record is searchable");
    assert.equal(legacyPayload.data.data[0].geo.fields.isp.value, "Legacy ISP");
    assert.equal(legacyPayload.data.data[0].device.model, "Synthetic Legacy Model");
    assert.ok(legacyPayload.data.data[0].id, "legacy ObjectId serializes for admin detail route");

    const publicResponse = await fetch(`${origin}/api/public/history`);
    const publicPayload = await publicResponse.json();
    const publicBody = JSON.stringify(publicPayload);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicPayload.data.total, 2);
    assert.ok(publicPayload.data.data.some(record => record.ip === "8.8.8.xxx"), "public IP remains masked");
    for (const secret of ["8.8.8.8", "Synthetic ISP", "Synthetic Org", "Legacy ISP", "Legacy Org", "latitude", "longitude", "device", "browser", "userAgent"]) {
      assert.equal(publicBody.includes(secret), false, `public history excludes ${secret}`);
    }

    const protectedDetail = await fetch(`${origin}/api/admin/history/${encodeURIComponent(adminPayload.data.data[0].id)}`, { headers: { Cookie: cookie } });
    assert.equal(protectedDetail.status, 200, "authenticated admin detail retrieves record");

    await closeServer(server);
    server = null;
    await client.close();
    client = null;

    ({ client: reconnectedClient } = await connectMongo({ uri: stagingConfig.uri, dbName, collectionName }));
    const reconnectedDb = reconnectedClient.db(dbName);
    const reconnectedRepository = new MongoVisitorRepository(
      reconnectedDb.collection(collectionName),
      reconnectedDb
    );
    await reconnectedRepository.ping();
    assert.equal((await reconnectedRepository.history({ limit: 10 })).total, 2, "fresh client reconnects and retrieves known test rows");

    process.stdout.write(`${JSON.stringify({ result: "PASS", database: dbName, collection: collectionName, checks: ["connection", "collection_and_indexes", "empty_database", "encrypted_insert_and_mask", "pagination", "admin_exact_ip_search", "synthetic_legacy_record", "admin_auth_and_detail", "public_privacy", "clean_disconnect", "new_client_reconnect"], note: "Disposable test records retained; no database or collection was dropped." })}\n`);
  } finally {
    await closeServer(server);
    await Promise.all([client?.close().catch(() => {}), reconnectedClient?.close().catch(() => {})]);
  }
}

run().catch(error => {
  process.stderr.write(`${JSON.stringify({ result: "FAIL", code: error.code || error.name || "STAGING_INTEGRATION_FAILED", namespace: activeNamespace, note: "Error details and credentials redacted; any generated staging namespace is retained and not dropped." })}\n`);
  process.exitCode = 1;
});
