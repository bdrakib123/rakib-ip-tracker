"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonFileVisitorRepository, FORMAT_VERSION } = require("../src/db/jsonFileRepository");
const { createStorageRepository, mountInfoHasPath } = require("../src/db/storage");
const { createVisitorService } = require("../src/services/visitorService");
const { detectDevice } = require("../src/device/detectDevice");
const { createApp } = require("../src/app");
const { createAdminAnalytics } = require("../src/services/adminAnalytics");

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rakib-ip-storage-"));
  return { directory, file: path.join(directory, "nested", "visitors.json") };
}

function record(index, createdAt = new Date(Date.now() - index * 1000)) {
  return {
    ipEncrypted: { algorithm: "aes-256-gcm", iv: "aXY=", tag: "dGFn", data: "ZW5jcnlwdGVk" },
    ipHash: crypto.createHash("sha256").update(`fixture-${index}`).digest("hex"),
    ipMasked: `203.0.113.${index % 255}.xxx`,
    geo: { country: "Fixtureland", city: `City ${index}`, isp: "Synthetic ISP" },
    device: { type: "desktop", category: "desktop", vendor: "Fixture", model: null },
    browser: { name: "Fixture Browser", version: "1" },
    os: { name: "Fixture OS", version: "1" },
    createdAt
  };
}

test("initializes a versioned storage file with private permissions and preserves it after reopen", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = await JsonFileVisitorRepository.open(file);
  const saved = await repository.insert(record(1));
  assert.equal(typeof saved._id, "string");
  assert.ok(saved.createdAt instanceof Date);
  const contents = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(contents.version, FORMAT_VERSION);
  assert.equal(contents.records.length, 1);
  assert.equal(Object.hasOwn(contents.records[0], "ip"), false);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await repository.close();

  const reopened = await JsonFileVisitorRepository.open(file);
  assert.equal((await reopened.findById(saved._id))._id, saved._id);
  assert.equal((await reopened.history()).total, 1);
  await reopened.close();
});

test("serializes concurrent writes and keeps history, search, pagination, and overview consistent", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = await JsonFileVisitorRepository.open(file);
  const saved = await Promise.all(Array.from({ length: 32 }, (_, index) => repository.insert(record(index))));
  assert.equal(new Set(saved.map(item => item._id)).size, 32);
  assert.equal(await repository.countByIpHash(saved.slice(0, 2).map(item => item.ipHash)), 2);
  assert.equal((await repository.history({ page: 1, limit: 10 })).total, 32);
  assert.equal((await repository.history({ page: 2, limit: 10 })).data.length, 10);
  assert.equal((await repository.history({ search: "Synthetic ISP" })).total, 0, "search does not expose unindexed private ISP data");
  assert.equal((await repository.history({ country: "Fixtureland", device: "desktop" })).total, 32);
  const overview = await repository.overview();
  assert.equal(overview.totalVisitors, 32);
  assert.equal(overview.last24h, 32);
  assert.deepEqual(overview.countries, [{ name: "Fixtureland", count: 32 }]);
  await repository.close();
});

test("exclusive file lock allows only one process owner and releases on close", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = await JsonFileVisitorRepository.open(file);
  await assert.rejects(JsonFileVisitorRepository.open(file), { code: "STORAGE_ALREADY_IN_USE" });
  await first.insert(record(1));
  await first.close();
  const second = await JsonFileVisitorRepository.open(file);
  assert.equal((await second.history()).total, 1);
  await second.close();
  await assert.rejects(fs.access(`${file}.lock`), { code: "ENOENT" });
});

test("closed repository cannot write after releasing its process lock", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = await JsonFileVisitorRepository.open(file);
  await first.close();
  const second = await JsonFileVisitorRepository.open(file);
  await assert.rejects(first.insert(record(1)), { code: "STORAGE_CLOSED" });
  await second.insert(record(2));
  assert.equal((await second.history()).total, 1);
  await second.close();
});

test("stale lock is preserved and production startup refuses an unmounted storage path", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lockPath = `${file}.lock`;
  const staleLock = JSON.stringify({ version: 1, pid: 999999, token: "synthetic-stale-lock" });
  await fs.writeFile(lockPath, staleLock, { mode: 0o600 });
  await assert.rejects(JsonFileVisitorRepository.open(file), { code: "STORAGE_ALREADY_IN_USE" });
  assert.equal(await fs.readFile(lockPath, "utf8"), staleLock);

  const mountPath = path.join(directory, "unmounted");
  const mountConfig = {
    nodeEnv: "production", storageBackend: "json-file", storageMountPath: mountPath,
    storageFile: path.join(mountPath, "visitors.json")
  };
  await assert.rejects(createStorageRepository(mountConfig), { code: "STORAGE_MOUNT_UNAVAILABLE" });
  await assert.rejects(fs.access(mountConfig.storageFile), { code: "ENOENT" });
});

test("persistent mount parser recognizes only exact decoded mount paths", () => {
  const mountInfo = "31 22 0:28 / /var/data rw,relatime - ext4 /dev/vdb rw\n32 22 0:29 / /var/data\\040backup rw,relatime - ext4 /dev/vdc rw";
  assert.equal(mountInfoHasPath(mountInfo, "/var/data"), true);
  assert.equal(mountInfoHasPath(mountInfo, "/var/data backup"), true);
  assert.equal(mountInfoHasPath(mountInfo, "/var"), false);
});

test("rejects corrupt, incompatible, and privacy-invalid storage without rewriting it", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const corrupt = "{not-json";
  await fs.writeFile(file, corrupt, { mode: 0o600 });
  await assert.rejects(JsonFileVisitorRepository.open(file), { code: "STORAGE_CORRUPT" });
  assert.equal(await fs.readFile(file, "utf8"), corrupt);

  await fs.writeFile(file, JSON.stringify({ version: FORMAT_VERSION + 1, records: [] }));
  await assert.rejects(JsonFileVisitorRepository.open(file), { code: "STORAGE_FORMAT_INVALID" });
  const incompatible = await fs.readFile(file, "utf8");
  assert.equal(incompatible, JSON.stringify({ version: FORMAT_VERSION + 1, records: [] }));

  const repositoryPath = path.join(directory, "privacy", "visitors.json");
  const repository = await JsonFileVisitorRepository.open(repositoryPath);
  await assert.rejects(repository.insert({ ...record(3), ip: "203.0.113.3" }), { code: "STORAGE_INPUT_INVALID" });
  assert.equal((await repository.history()).total, 0);
  await repository.close();
});

test("file storage validates records and reports unhealthy storage without leaking paths", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ version: FORMAT_VERSION, records: [{ _id: "broken", createdAt: "bad-date" }] }));
  await assert.rejects(JsonFileVisitorRepository.open(file), error => {
    assert.equal(error.code, "STORAGE_RECORD_INVALID");
    assert.equal(error.message.includes(directory), false);
    return true;
  });
});

test("file-backed APIs preserve public privacy, admin history authorization, analytics, and storage health", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = await JsonFileVisitorRepository.open(file);
  const geo = {
    status: "partial", precision: "approximate", source: "synthetic", errorCode: null,
    fields: {
      country: { value: "Fixtureland", status: "available" },
      countryCode: { value: "FX", status: "available" },
      region: { value: "Fixture Region", status: "available" },
      city: { value: "Fixture City", status: "available" },
      postal: { value: null, status: "unavailable" }, timezone: { value: null, status: "unavailable" },
      isp: { value: "Synthetic ISP", status: "available" }, organization: { value: "Synthetic Org", status: "available" },
      asn: { value: "AS64500", status: "available" }, latitude: { value: 1, status: "available" }, longitude: { value: 2, status: "available" }
    }
  };
  const geoService = { lookup: async () => structuredClone(geo), health: () => ({ provider: "fixture", state: "not_checked" }) };
  const password = "file-storage-test-admin-password";
  const visitorService = createVisitorService({
    repository, geoService, detectDevice, encryptionKey: "b".repeat(64),
    logger: { warn() {} }
  });
  const analytics = createAdminAnalytics({ repository, geoService });
  const app = createApp({
    config: { adminPassword: password, nodeEnv: "test", trustProxyHops: 0, publicRateLimit: 30, loginRateLimit: 5 },
    repository, visitorService, geoService, analytics, logger: { error() {} }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await visitorService.record({
      ip: "8.8.8.8", socket: { remoteAddress: "127.0.0.1" },
      get: name => name.toLowerCase() === "user-agent" ? "Mozilla/5.0 (X11; Linux x86_64) Chrome/122.0.0.0 Safari/537.36" : ""
    });
    assert.equal(created.ip, "8.8.8.8");

    const publicHistory = await fetch(`${origin}/api/public/history`).then(response => response.json());
    const publicText = JSON.stringify(publicHistory);
    assert.equal(publicHistory.data.total, 1);
    assert.equal(publicHistory.data.data[0].ip, "8.8.8.xxx");
    for (const secret of ["8.8.8.8", "Synthetic ISP", "Synthetic Org", "latitude", "longitude", "userAgent"]) {
      assert.equal(publicText.includes(secret), false);
    }
    assert.equal((await fetch(`${origin}/api/admin/history`)).status, 401);

    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const history = await fetch(`${origin}/api/admin/history?search=8.8.8.8`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(history.data.total, 1);
    assert.equal(history.data.data[0].ip, "8.8.8.8");

    const overview = await fetch(`${origin}/api/admin/analytics/overview`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(overview.data.totalVisitors, 1);
    assert.deepEqual(overview.data.countries, [{ name: "Fixtureland", count: 1 }]);
    const health = await fetch(`${origin}/api/admin/server/health`, { headers: { Cookie: cookie } }).then(response => response.json());
    assert.equal(health.data.storage, "available");
    assert.equal(health.data.database, "not_configured");
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await repository.close();
  }
});

test("normal server startup succeeds without MongoDB configuration and reopens storage after restart", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { start } = require("../src/server");
  const env = {
    NODE_ENV: "test", PORT: "3000", STORAGE_BACKEND: "json-file", STORAGE_FILE: file,
    ADMIN_PASSWORD: "startup-test-admin-password", IP_ENCRYPTION_KEY: "c".repeat(64)
  };
  assert.equal(Object.hasOwn(env, "MONGODB_URI"), false);
  assert.equal(Object.keys(require.cache).some(file => file.includes("/node_modules/mongodb/")), false);
  const logger = { info() {}, warn() {}, error() {} };
  const first = await start({ env, logger, listenPort: 0, listenHost: "127.0.0.1" });
  try {
    assert.equal(Object.keys(require.cache).some(file => file.includes("/node_modules/mongodb/")), false);
    assert.equal((await fetch(`http://127.0.0.1:${first.server.address().port}/healthz`)).status, 200);
    assert.ok(await first.repository.ping());
  } finally {
    first.server.closeAllConnections?.();
    await new Promise(resolve => first.server.close(resolve));
    await first.repository.close();
  }
  const second = await start({ env, logger, listenPort: 0, listenHost: "127.0.0.1" });
  try {
    assert.equal((await second.repository.history()).total, 0);
    assert.ok(await second.repository.ping());
  } finally {
    second.server.closeAllConnections?.();
    await new Promise(resolve => second.server.close(resolve));
    await second.repository.close();
  }
});

test("explicit ephemeral staging storage stays in an isolated temp directory and reopens after simulated restart", async t => {
  const { directory } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stagingDir = path.join(directory, "temporary-staging");
  const config = {
    nodeEnv: "production", stagingMode: true, stagingEphemeralStorage: true,
    stagingStorageDir: stagingDir, storageFile: path.join(stagingDir, "visitors.json"),
    storageBackend: "json-file", storageMountPath: null
  };
  const repository = await createStorageRepository(config);
  await repository.insert(record(999));
  await repository.close();
  assert.equal(path.resolve(config.storageFile).startsWith(path.resolve(os.tmpdir()) + path.sep), true);
  assert.notEqual(config.storageFile, "/var/data/visitors.json");
  const reopened = await createStorageRepository(config);
  assert.equal((await reopened.history()).total, 1);
  await reopened.close();
  await assert.rejects(createStorageRepository({ ...config, stagingEphemeralStorage: false }), { code: "STAGING_STORAGE_CONFIG_INVALID" });
});

test("production storage still rejects missing persistent mount even when an ephemeral path is supplied", async t => {
  const { directory, file } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(createStorageRepository({
    nodeEnv: "production", stagingMode: false, stagingEphemeralStorage: false,
    storageBackend: "json-file", storageMountPath: null, storageFile: file
  }), { code: "STORAGE_MOUNT_UNAVAILABLE" });
  await assert.rejects(fs.access(file), { code: "ENOENT" });
});

test("temporary staging server starts with no MongoDB variables and applies the access gate", async t => {
  const { directory } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { start } = require("../src/server");
  const env = {
    NODE_ENV: "production", TRUST_PROXY_HOPS: "0", PORT: "3000", STORAGE_BACKEND: "json-file",
    STAGING_MODE: "true", STAGING_EPHEMERAL_STORAGE: "true",
    STAGING_ACCESS_PASSWORD: "synthetic-startup-gate-password-long-enough",
    STAGING_STORAGE_DIR: path.join(directory, "temporary-staging"),
    ADMIN_PASSWORD: "synthetic-staging-admin-password-long-enough",
    IP_ENCRYPTION_KEY: "d".repeat(64)
  };
  assert.equal(Object.hasOwn(env, "MONGODB_URI"), false);
  const logger = { info() {}, warn() {}, error() {} };
  const first = await start({ env, logger, listenPort: 0, listenHost: "127.0.0.1" });
  try {
    const origin = `http://127.0.0.1:${first.server.address().port}`;
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
    assert.equal((await fetch(`${origin}/api/public/history`)).status, 401);
    assert.equal(Object.keys(require.cache).some(file => file.includes("/node_modules/mongodb/")), false);
  } finally {
    first.server.closeAllConnections?.();
    await new Promise(resolve => first.server.close(resolve));
    await first.repository.close();
  }
  const second = await start({ env, logger, listenPort: 0, listenHost: "127.0.0.1" });
  try {
    assert.equal((await second.repository.history()).total, 0);
  } finally {
    second.server.closeAllConnections?.();
    await new Promise(resolve => second.server.close(resolve));
    await second.repository.close();
  }
});
