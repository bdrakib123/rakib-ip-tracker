"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { configureNeonFetch, createIpv4Fetch, ipv4Fetch } = require("../src/db/neonTransport");

test("IPv4 Neon fetch pins family 4 and preserves fetch request and response data", async () => {
  let observed;
  const fetch = createIpv4Fetch({
    request(url, options, onResponse) {
      observed = { url: url.href, options, body: "" };
      const outgoing = new EventEmitter();
      outgoing.write = chunk => { observed.body += chunk; };
      outgoing.end = () => {
        const incoming = new PassThrough();
        incoming.statusCode = 200;
        incoming.statusMessage = "OK";
        incoming.headers = { "content-type": "application/json" };
        queueMicrotask(() => {
          onResponse(incoming);
          incoming.end('{"ok":true}');
        });
      };
      outgoing.destroy = error => queueMicrotask(() => outgoing.emit("error", error));
      return outgoing;
    }
  });

  const response = await fetch("https://db.example.test/sql", {
    method: "POST", headers: { "content-type": "application/json" }, body: "synthetic query"
  });

  assert.equal(observed.url, "https://db.example.test/sql");
  assert.equal(observed.options.family, 4);
  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.timeout, 20_000);
  assert.deepEqual(observed.options.headers, { "content-type": "application/json" });
  assert.equal(observed.body, "synthetic query");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("Neon IPv4 transport only overrides the driver fetch when explicitly enabled", () => {
  const config = { fetchFunction: "existing" };
  configureNeonFetch(config, false);
  assert.equal(config.fetchFunction, "existing");
  configureNeonFetch(config, true);
  assert.equal(config.fetchFunction, ipv4Fetch);
});

test("IPv4 Neon fetch rejects a network failure without converting it into a response", async () => {
  const fetch = createIpv4Fetch({
    request() {
      const outgoing = new EventEmitter();
      outgoing.write = () => {};
      outgoing.end = () => queueMicrotask(() => outgoing.emit("error", new Error("synthetic network failure")));
      outgoing.destroy = error => queueMicrotask(() => outgoing.emit("error", error));
      return outgoing;
    }
  });
  await assert.rejects(fetch("https://db.example.test/sql"), /synthetic network failure/);
});
