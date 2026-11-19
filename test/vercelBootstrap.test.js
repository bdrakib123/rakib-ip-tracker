"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVercelApplication } = require("../src/vercelApplication");

function env() {
  return { VERCEL: "1", NODE_ENV: "production", STORAGE_BACKEND: "neon-postgres", DATABASE_URL: "postgresql://synthetic.invalid/db",
    ADMIN_PASSWORD: "synthetic-vercel-admin-password", IP_ENCRYPTION_KEY: "e".repeat(64), TRUST_PROXY_HOPS: "0" };
}

test("Vercel application bootstrap shares initialization and injects the persistent repository and waitUntil", async () => {
  const repository = {
    persistent: true,
    async getAnalytics() { return { version: 1, collectedFrom: new Date().toISOString(), requests: [], pages: [], security: [], sessions: [] }; }
  };
  let captured;
  const marker = () => {};
  const app = await createVercelApplication({ env: env(), repositoryFactory: async () => repository, waitUntil: marker,
    appFactory: options => { captured = options; return marker; } });
  assert.equal(app, marker);
  assert.equal(captured.config.vercelMode, true);
  assert.equal(captured.repository, repository);
  assert.equal(captured.waitUntil, marker);
});

test("Vercel bootstrap rejects unconfigured storage before opening a repository", async () => {
  let opened = false;
  const missing = env(); delete missing.DATABASE_URL;
  await assert.rejects(createVercelApplication({ env: missing, repositoryFactory: async () => { opened = true; } }), /DATABASE_URL/);
  assert.equal(opened, false);
});
