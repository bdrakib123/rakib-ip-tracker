"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { adminSearchOptions } = require("../src/services/visitorService");

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
