"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoVisitorRepository, connectMongo } = require("../src/db/mongoRepository");

test("Mongo repository initializes indexes and returns empty history/overview safely", async () => {
  const indexes = [];
  const collection = {
    async createIndex(spec) { indexes.push(spec); return Object.keys(spec).join("_"); },
    async countDocuments() { return 0; },
    find() { return { sort() { return this; }, skip() { return this; }, limit() { return this; }, async toArray() { return []; } }; },
    aggregate() { return { async toArray() { return []; } }; }
  };
  const repository = new MongoVisitorRepository(collection, { command: async () => ({ ok: 1 }) });
  await repository.ensureIndexes();
  assert.deepEqual(indexes, [{ createdAt: -1 }, { ipHash: 1, createdAt: -1 }]);
  assert.equal(await repository.ping(), true);
  assert.deepEqual(await repository.history({ page: 1, limit: 10 }), { page: 1, limit: 10, total: 0, pages: 0, data: [] });
  const overview = await repository.overview();
  assert.equal(overview.totalVisitors, 0);
  assert.equal(overview.last24h, 0);
  assert.deepEqual(overview.countries, []);
  assert.deepEqual(overview.devices, []);
});

test("connectMongo enforces bounded server selection and closes after connection timeout/failure", async () => {
  let options;
  let closed = false;
  class FailingClient {
    constructor(uri, clientOptions) { options = clientOptions; assert.equal(uri, "mongodb://staging.test.invalid"); }
    async connect() { throw Object.assign(new Error("synthetic timeout"), { name: "MongoServerSelectionError" }); }
    async close() { closed = true; }
  }
  await assert.rejects(connectMongo({ uri: "mongodb://staging.test.invalid", dbName: "rakib_ip_v2_staging_test", collectionName: "visitors_test", MongoClientClass: FailingClient }), /synthetic timeout/);
  assert.equal(options.serverSelectionTimeoutMS, 8000);
  assert.equal(options.maxPoolSize, 10);
  assert.equal(closed, true);
});

test("a fresh client can recover after a failed connection and transient ping failure", async () => {
  let attempts = 0;
  let pingAttempts = 0;
  const collection = { async createIndex() { return "ok"; } };
  class RecoveringClient {
    constructor() {}
    async connect() { attempts += 1; if (attempts === 1) throw new Error("synthetic database unavailable"); }
    db() { return { collection: () => collection, async command() { pingAttempts += 1; if (pingAttempts === 1) throw new Error("synthetic transient ping failure"); return { ok: 1 }; } }; }
    async close() {}
  }
  await assert.rejects(connectMongo({ uri: "mongodb://staging.test.invalid", dbName: "rakib_ip_v2_staging_test", collectionName: "visitors_test", MongoClientClass: RecoveringClient }), /synthetic database unavailable/);
  const recovered = await connectMongo({ uri: "mongodb://staging.test.invalid", dbName: "rakib_ip_v2_staging_test", collectionName: "visitors_test", MongoClientClass: RecoveringClient });
  await assert.rejects(recovered.repository.ping(), /synthetic transient ping failure/);
  assert.equal(await recovered.repository.ping(), true);
  assert.equal(attempts, 2);
  assert.equal(pingAttempts, 2);
  await recovered.client.close();
});
