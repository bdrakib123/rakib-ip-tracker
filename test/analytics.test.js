"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonFileVisitorRepository, FORMAT_VERSION } = require("../src/db/jsonFileRepository");
const { createAdminAnalytics } = require("../src/services/adminAnalytics");

async function openFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rakib-analytics-"));
  const file = path.join(directory, "visitors.json");
  const repository = await JsonFileVisitorRepository.open(file);
  return { directory, file, repository };
}

function request({ path: route = "/", status = 200, createdAt = new Date().toISOString(), sessionId = null } = {}) {
  return { type: "request", method: "GET", path: route, status, duration: 12, createdAt, sessionId };
}

test("analytics are persisted atomically and survive repository restart", async t => {
  const fixture = await openFixture();
  t.after(async () => fs.rm(fixture.directory, { recursive: true, force: true }));
  const sessionId = "a".repeat(64);
  await fixture.repository.saveAnalyticsBatch([
    request({ path: "/", sessionId }),
    { type: "page", method: "POST", path: "/dashboard", duration: 240, createdAt: new Date().toISOString(), sessionId },
    request({ path: "/api/admin/history", status: 401 }),
    request({ path: "/[redacted]", status: 404, securityType: "not_found" })
  ]);
  const first = await fixture.repository.analyticsSnapshot();
  assert.equal(first.runtime.totalRequests, 3);
  assert.equal(first.totalPageViews, 1);
  assert.equal(first.activeSessions, 1);
  assert.equal(first.securityEvents.length, 2);
  assert.deepEqual(first.pageRows, [{ path: "/dashboard", views: 1, averageDuration: 240 }]);
  await fixture.repository.close();

  const reopened = await JsonFileVisitorRepository.open(fixture.file);
  const afterRestart = await reopened.analyticsSnapshot();
  assert.equal(afterRestart.runtime.totalRequests, 3);
  assert.equal(afterRestart.pageRows[0].averageDuration, 240);
  const detail = await reopened.sessionAnalyticsDetail(sessionId);
  assert.equal(detail.session.requestCount, 1);
  assert.equal(detail.pages.length, 1);
  assert.equal(detail.session.userAgent, null);
  assert.equal(detail.session.ipHash, null);
  await reopened.close();
});

test("graceful analytics close flushes queued events before repository shutdown", async t => {
  const fixture = await openFixture();
  t.after(async () => fs.rm(fixture.directory, { recursive: true, force: true }));
  const analytics = createAdminAnalytics({
    repository: fixture.repository,
    geoService: { health: () => ({ state: "not_checked" }) },
    encryptionKey: "0123456789abcdef".repeat(4),
    flushDelayMs: 60_000
  });
  analytics.record(request({ path: "/graceful-shutdown" }));
  await analytics.close();
  await fixture.repository.close();
  const reopened = await JsonFileVisitorRepository.open(fixture.file);
  const snapshot = await reopened.analyticsSnapshot();
  assert.equal(snapshot.runtime.totalRequests, 1);
  assert.equal(snapshot.requestEvents[0].path, "/graceful-shutdown");
  await reopened.close();
});

test("simultaneous visitor and analytics mutations are serialized without lost records", async t => {
  const fixture = await openFixture();
  t.after(async () => fs.rm(fixture.directory, { recursive: true, force: true }));
  const writes = [];
  for (let index = 0; index < 12; index += 1) {
    writes.push(fixture.repository.insert({ _id: `synthetic-${index}`, createdAt: new Date(), ipMasked: "203.0.113.xxx", ipHash: `hash-${index}` }));
    writes.push(fixture.repository.saveAnalyticsBatch([request({ path: `/synthetic/${index}` })]));
  }
  await Promise.all(writes);
  assert.equal((await fixture.repository.history({ limit: 50 })).total, 12);
  assert.equal((await fixture.repository.analyticsSnapshot()).runtime.totalRequests, 12);
  await fixture.repository.close();
});

test("analytics retention removes expired events and caps stored request records", async t => {
  const fixture = await openFixture();
  t.after(async () => fs.rm(fixture.directory, { recursive: true, force: true }));
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  await fixture.repository.saveAnalyticsBatch([request({ path: "/expired", createdAt: old, sessionId: "b".repeat(64) })]);
  assert.equal((await fixture.repository.analyticsSnapshot()).runtime.totalRequests, 0);

  let index = 0;
  while (index < 5001) {
    const batch = [];
    for (let end = Math.min(index + 1000, 5001); index < end; index += 1) {
      batch.push(request({ path: "/synthetic/" + index }));
    }
    await fixture.repository.saveAnalyticsBatch(batch);
  }
  const snapshot = await fixture.repository.analyticsSnapshot();
  assert.equal(snapshot.runtime.totalRequests, 5000);
  assert.equal(snapshot.requestEvents.some(event => event.path === "/synthetic/0"), false);
  assert.equal(snapshot.requestEvents.some(event => event.path === "/synthetic/5000"), true);
  await fixture.repository.close();
});

test("expired analytics are pruned atomically on restart and read without a new event", async t => {
  const fixture = await openFixture();
  t.after(async () => fs.rm(fixture.directory, { recursive: true, force: true }));
  await fixture.repository.close();
  const state = JSON.parse(await fs.readFile(fixture.file, "utf8"));
  const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const sessionId = "c".repeat(64);
  state.analytics.requests = [{ method: "GET", path: "/", status: 200, duration: 3, createdAt: expiredAt, sessionId, referrer: null }];
  state.analytics.pages = [{ method: "POST", path: "/", duration: null, createdAt: expiredAt, sessionId, title: null, referrer: null }];
  state.analytics.security = [{ type: "unauthorized", method: "GET", path: "/", createdAt: expiredAt, sessionId: null }];
  state.analytics.sessions = [{ sessionId, createdAt: expiredAt, lastSeen: expiredAt, updatedAt: expiredAt, requestCount: 1, firstPath: "/" }];
  await fs.writeFile(fixture.file, `${JSON.stringify(state)}\n`, { mode: 0o600 });

  const reopened = await JsonFileVisitorRepository.open(fixture.file);
  const snapshot = await reopened.analyticsSnapshot();
  assert.equal(snapshot.runtime.totalRequests, 0);
  assert.equal(snapshot.totalPageViews, 0);
  assert.equal(snapshot.securityEvents.length, 0);
  assert.equal(snapshot.sessions.length, 0);
  assert.equal(JSON.parse(await fs.readFile(fixture.file, "utf8")).records.length, 0);
  await reopened.close();
});

test("invalid analytics batches and corrupt analytics documents are rejected without rewriting", async t => {
  const fixture = await openFixture();
  t.after(async () => fs.rm(fixture.directory, { recursive: true, force: true }));
  await assert.rejects(fixture.repository.saveAnalyticsBatch([request({ path: "https://outside.invalid" })]), { code: "STORAGE_ANALYTICS_INPUT_INVALID" });
  await assert.rejects(fixture.repository.saveAnalyticsBatch([{
    type: "request", method: "GET", path: "/", status: 200, duration: -1, createdAt: new Date().toISOString(), sessionId: null
  }]), { code: "STORAGE_ANALYTICS_INPUT_INVALID" });
  await fixture.repository.close();
  const valid = JSON.parse(await fs.readFile(fixture.file, "utf8"));
  valid.analytics.sessions.push({ sessionId: "not-a-keyed-id", createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), updatedAt: new Date().toISOString(), requestCount: 1, firstPath: "/" });
  const corrupt = JSON.stringify(valid);
  await fs.writeFile(fixture.file, corrupt, { mode: 0o600 });
  await assert.rejects(JsonFileVisitorRepository.open(fixture.file), { code: "STORAGE_ANALYTICS_INVALID" });
  assert.equal(await fs.readFile(fixture.file, "utf8"), corrupt);
});

test("storage format is versioned and analytics stays within the existing JSON format", async t => {
  const fixture = await openFixture();
  t.after(async () => { await fixture.repository.close(); await fs.rm(fixture.directory, { recursive: true, force: true }); });
  const state = JSON.parse(await fs.readFile(fixture.file, "utf8"));
  assert.equal(state.version, FORMAT_VERSION);
  assert.equal(FORMAT_VERSION, 2);
  assert.equal(state.analytics.version, 1);
  assert.deepEqual(state.records, []);
});
