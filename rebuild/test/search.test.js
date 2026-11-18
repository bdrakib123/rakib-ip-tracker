"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { adminSearchOptions } = require("../src/services/visitorService");
const { MongoVisitorRepository } = require("../src/db/mongoRepository");

const key = "0123456789abcdef".repeat(4);

test("exact IP search hashes only for admin queries and supports legacy hashes", () => {
  const result = adminSearchOptions({ search: "8.8.8.8", page: 2 }, key);
  assert.equal(result.search, "8.8.8.8");
  assert.equal(result.page, 2);
  assert.deepEqual(result.ipSearchHashes, [
    crypto.createHmac("sha256", Buffer.from(key, "hex")).update("8.8.8.8").digest("hex"),
    crypto.createHash("sha256").update("8.8.8.8").digest("hex")
  ]);
  assert.equal(adminSearchOptions({ search: "not-an-ip" }, key).ipSearchHashes, undefined);
});

test("Mongo history adds only validated exact-IP hashes to the admin search query", async () => {
  let actualQuery;
  const collection = {
    async countDocuments(query) { actualQuery = query; return 0; },
    find(query) {
      actualQuery = query;
      return { sort() { return this; }, skip() { return this; }, limit() { return this; }, async toArray() { return []; } };
    }
  };
  const repository = new MongoVisitorRepository(collection, {});
  const hash = "a".repeat(64);
  await repository.history({ search: "8.8.8.8", ipSearchHashes: [hash, { $ne: null }, "bad"] });
  const searchQuery = actualQuery.$and[0].$or;
  assert.ok(searchQuery.some(condition => condition.ipHash?.$in?.length === 1 && condition.ipHash.$in[0] === hash));
  assert.equal(searchQuery.some(condition => condition.ipHash?.$ne), false);
});
