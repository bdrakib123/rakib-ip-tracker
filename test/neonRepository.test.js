"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createNeonRepository } = require("../src/db/neonRepository");
const { createStorageRepository } = require("../src/db/storage");
const { loadConfig } = require("../src/config");
const { runMigrations, splitMigrationSql } = require("../scripts/migrateNeon");

function fakeSql() {
  const queries = [];
  const transactions = [];
  const tag = (parts, ...values) => ({
    text: parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ""), ""),
    values
  });
  tag.queries = queries;
  tag.transactions = transactions;
  tag.query = async (text, values = []) => {
    queries.push({ text, values });
    if (text.startsWith("INSERT INTO visitors")) return [{ id: values[0], created_at: values[1], payload: JSON.parse(values[6]) }];
    if (text.includes("count(*)::int AS total")) return [{ total: 0 }];
    if (text.includes("count(*)::int AS count")) return [{ count: 0 }];
    if (text.includes("INSERT INTO rate_limit_buckets")) return [{ request_count: 1, window_started_at: new Date() }];
    return [];
  };
  tag.transaction = async statements => { transactions.push(statements); return statements.map(() => []); };
  return tag;
}

test("manual migration runner requires an explicitly injected DATABASE_URL and does not load repository .env", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "migrateNeon.js"), "utf8");
  assert.match(source, /env\.DATABASE_URL/);
  assert.doesNotMatch(source, /dotenv/);
});

test("storage factory initializes the existing Neon adapter for a Render production configuration", async () => {
  const env = {
    NODE_ENV: "production", STORAGE_BACKEND: "neon-postgres", DATABASE_URL: "postgresql://synthetic.invalid/render",
    ADMIN_PASSWORD: "synthetic-render-admin-password", IP_ENCRYPTION_KEY: "a".repeat(64), TRUST_PROXY_HOPS: "1"
  };
  const config = loadConfig(env);
  const sql = fakeSql();
  sql.query = async text => {
    if (text.startsWith("SELECT version FROM schema_migrations")) return [{ version: 1 }];
    if (text === "SELECT 1 AS ok") return [{ ok: 1 }];
    return [];
  };
  let receivedUrl;
  const repository = await createStorageRepository(config, {
    neonFactory(url) { receivedUrl = url; return sql; }
  });
  assert.equal(receivedUrl, env.DATABASE_URL);
  assert.equal(repository.persistent, true);
  await repository.close();
});

test("storage factory rejects a false Neon readiness result and closes the repository", async () => {
  const config = loadConfig({
    NODE_ENV: "production", STORAGE_BACKEND: "neon-postgres", DATABASE_URL: "postgresql://synthetic.invalid/render",
    ADMIN_PASSWORD: "synthetic-render-admin-password", IP_ENCRYPTION_KEY: "a".repeat(64), TRUST_PROXY_HOPS: "1"
  });
  let closed = false;
  await assert.rejects(createStorageRepository(config, {
    neonFactory() { return fakeSql(); },
    neonRepositoryFactory() {
      return { async assertSchema() {}, async ping() { return false; }, async close() { closed = true; } };
    }
  }), { code: "DATABASE_OPERATION_FAILED" });
  assert.equal(closed, true);
});

function migrationSql({ initiallyApplied = [], delayMs = 0 } = {}) {
  const applied = new Set(initiallyApplied);
  const transactions = [];
  let failAt = null;
  let transactionActive = 0;
  let maxConcurrentTransactions = 0;
  let tail = Promise.resolve();
  const tx = (parts, ...values) => {
    let text = "";
    const params = [];
    parts.forEach((part, index) => {
      text += part;
      if (index < values.length) {
        const value = values[index];
        if (value && value.__unsafeSql === true) text += value.text;
        else { params.push(value); text += `$${params.length}`; }
      }
    });
    return { text, values: params };
  };
  tx.unsafe = text => ({ __unsafeSql: true, text });
  const sql = {
    transactions,
    get applied() { return applied; },
    get maxConcurrentTransactions() { return maxConcurrentTransactions; },
    set failAt(value) { failAt = value; },
    query: async (text, values = []) => {
      if (text.startsWith("SELECT version FROM schema_migrations")) {
        return applied.size ? [{ version: Math.max(...applied) }] : [];
      }
      if (text.startsWith("SELECT 1 FROM schema_migrations")) return applied.has(values[0]) ? [{ one: 1 }] : [];
      throw new Error("Unexpected migration preflight query");
    },
    transaction: async build => {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      transactionActive += 1;
      maxConcurrentTransactions = Math.max(maxConcurrentTransactions, transactionActive);
      try {
        const statements = build(tx);
        transactions.push(statements);
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        const migrationBlock = statements.find(item => item.text.includes("DO $rakib_apply_"));
        if (migrationBlock) {
          const version = Number(migrationBlock.text.match(/WHERE version = (\d+)/)?.[1]);
          if (!version) throw new Error("Synthetic migration version was not found.");
          let didApply = false;
          if (!applied.has(version)) {
            if (failAt === "statement" && migrationBlock.text.includes("visitors_created_at_idx")) throw new Error("synthetic statement failure");
            if (failAt === "version" && migrationBlock.text.includes("INSERT INTO schema_migrations")) throw new Error("synthetic version write failure");
            applied.add(version);
            didApply = true;
          }
          return statements.map((_item, index) => index === statements.length - 1 ? [{ applied: didApply }] : []);
        }
        return statements.map(() => []);
      } finally {
        transactionActive -= 1;
        release();
      }
    }
  };
  return sql;
}

test("Neon repository inserts concurrent visitor records with encrypted-only IP fields", async () => {
  const sql = fakeSql();
  const repository = createNeonRepository({ sql });
  const make = id => ({ _id: id, createdAt: new Date().toISOString(), ipEncrypted: { algorithm: "aes-256-gcm", data: "synthetic-ciphertext" }, ipHash: "a".repeat(64), ipMasked: "203.0.113.xxx", geo: { country: "Testland" }, device: { category: "desktop" } });
  const records = await Promise.all([repository.insert(make("visitor-a")), repository.insert(make("visitor-b"))]);
  assert.equal(records.length, 2);
  const inserts = sql.queries.filter(item => item.text.startsWith("INSERT INTO visitors"));
  assert.equal(inserts.length, 2);
  assert.doesNotMatch(inserts[0].text, /\bip\s*[,)=]/i);
  assert.equal(JSON.parse(inserts[0].values[6]).ipEncrypted.algorithm, "aes-256-gcm");
  assert.equal(Object.hasOwn(JSON.parse(inserts[0].values[6]), "ip"), false);
});

test("Neon history search parameterizes hostile text and uses bounded pagination", async () => {
  const sql = fakeSql();
  const repository = createNeonRepository({ sql });
  await repository.history({ page: 2, limit: 20, search: "%' OR TRUE --" });
  const reads = sql.queries.filter(item => item.text.includes("FROM visitors"));
  assert.equal(reads.length, 2);
  assert.equal(reads.some(item => item.text.includes("OR TRUE")), false);
  assert.ok(reads[0].values.some(value => String(value).includes("OR TRUE")));
  assert.equal(reads[1].values.at(-2), 20);
  assert.equal(reads[1].values.at(-1), 20);
});

test("Neon analytics initialize metadata atomically across concurrent repository instances", async () => {
  let metadata = null;
  let initializationAttempts = 0;
  const sql = fakeSql();
  sql.query = async (text, values = []) => {
    sql.queries.push({ text, values });
    if (text.startsWith("INSERT INTO analytics_metadata")) {
      initializationAttempts += 1;
      if (!metadata) metadata = values[0];
      await new Promise(resolve => setImmediate(resolve));
      return [];
    }
    if (text.includes("SELECT collected_from FROM analytics_metadata")) return metadata ? [{ collected_from: metadata }] : [];
    return [];
  };
  const first = createNeonRepository({ sql });
  const second = createNeonRepository({ sql });
  const [sameA, sameB, otherInstance] = await Promise.all([first.getAnalytics(), first.getAnalytics(), second.getAnalytics()]);
  assert.equal(initializationAttempts, 2); // Coalesced within one instance; ON CONFLICT makes the cross-instance attempt atomic.
  assert.equal(sameA.collectedFrom, sameB.collectedFrom);
  assert.equal(sameA.collectedFrom, otherInstance.collectedFrom);
  assert.match(sql.queries.find(item => item.text.startsWith("INSERT INTO analytics_metadata")).text, /ON CONFLICT \(singleton\) DO NOTHING/);
});

test("Neon clear-all resets analytics collection metadata instead of deleting its initialized row", async () => {
  const sql = fakeSql();
  const repository = createNeonRepository({ sql });
  await repository.clearAll();
  const batch = sql.transactions[0].map(item => item.text).join("\n");
  assert.match(batch, /INSERT INTO analytics_metadata .*ON CONFLICT \(singleton\) DO UPDATE SET collected_from = EXCLUDED\.collected_from/);
  assert.doesNotMatch(batch, /DELETE FROM analytics_metadata/);
});

test("Neon analytics event views order by timestamp and stable identity before limiting", async () => {
  const base = Date.now() - 5_000;
  const at = offset => new Date(base + offset);
  const sessionId = "f".repeat(64);
  const requests = [
    { id: 15, created_at: at(2000), method: "GET", path: "/request-latest", status: 200, duration_ms: 1, session_identifier: sessionId },
    { id: 13, created_at: at(1000), method: "GET", path: "/request-middle", status: 200, duration_ms: 1, session_identifier: sessionId },
    { id: 12, created_at: at(0), method: "GET", path: "/request-tie-new", status: 200, duration_ms: 1, session_identifier: sessionId },
    { id: 8, created_at: at(0), method: "GET", path: "/request-tie-old", status: 200, duration_ms: 1, session_identifier: sessionId }
  ];
  const pages = [
    { id: 9, created_at: at(2000), method: "POST", path: "/page-latest", duration_ms: 2, session_identifier: sessionId },
    { id: 6, created_at: at(0), method: "POST", path: "/page-tie-new", duration_ms: 2, session_identifier: sessionId },
    { id: 4, created_at: at(0), method: "POST", path: "/page-tie-old", duration_ms: 2, session_identifier: sessionId }
  ];
  const security = [
    { id: 7, created_at: at(2000), event_type: "unauthorized", method: "GET", path: "/security-latest" },
    { id: 5, created_at: at(0), event_type: "rate_limited", method: "GET", path: "/security-tie-new" },
    { id: 2, created_at: at(0), event_type: "forbidden", method: "GET", path: "/security-tie-old" }
  ];
  let metadata = null;
  const sql = fakeSql();
  sql.query = async (text, values = []) => {
    sql.queries.push({ text, values });
    if (text.startsWith("INSERT INTO analytics_metadata")) { metadata ||= values[0]; return []; }
    if (text.includes("SELECT collected_from FROM analytics_metadata")) return [{ collected_from: metadata }];
    if (text.includes("FROM request_analytics") && text.includes("WHERE created_at")) return requests;
    if (text.includes("FROM page_analytics") && text.includes("WHERE created_at")) return pages;
    if (text.includes("FROM security_analytics")) return security;
    if (text.includes("FROM visitor_sessions") && text.includes("WHERE last_seen")) return [];
    if (text.includes("FROM visitor_sessions") && text.includes("WHERE session_identifier")) return [{ session_identifier: sessionId, created_at: at(0), last_seen: at(2000), updated_at: at(2000), request_count: 4, first_path: "/" }];
    if (text.includes("FROM page_analytics") && text.includes("WHERE session_identifier")) return pages;
    if (text.includes("FROM request_analytics") && text.includes("WHERE session_identifier")) return requests;
    return [];
  };
  const repository = createNeonRepository({ sql });
  const analytics = await repository.getAnalytics();
  const snapshot = await repository.analyticsSnapshot();
  const detail = await repository.sessionAnalyticsDetail(sessionId);
  assert.deepEqual(analytics.requests.map(event => event.path), requests.map(row => row.path));
  assert.deepEqual(analytics.pages.map(event => event.path), pages.map(row => row.path));
  assert.deepEqual(analytics.security.map(event => event.path), security.map(row => row.path));
  assert.deepEqual(snapshot.requestEvents.slice(0, 4).map(event => event.path), requests.map(row => row.path));
  assert.deepEqual(snapshot.securityEvents.map(event => event.path), security.map(row => row.path));
  assert.deepEqual(detail.pages.map(event => event.path), pages.map(row => row.path));
  assert.deepEqual(detail.requests.map(event => event.path), requests.map(row => row.path));
  assert.match(sql.queries.find(item => item.text.includes("FROM request_analytics") && item.text.includes("WHERE created_at")).text, /ORDER BY created_at DESC, id DESC LIMIT/);
  assert.match(sql.queries.find(item => item.text.includes("WHERE session_identifier = \$1") && item.text.includes("FROM request_analytics")).text, /ORDER BY created_at DESC, id DESC LIMIT \$2/);
});

test("analytics writes use an atomic transaction and parameterize paths/session values", async () => {
  const sql = fakeSql();
  const repository = createNeonRepository({ sql });
  const hostilePath = "/x'); DROP TABLE visitors;--";
  await repository.saveAnalyticsBatch([{ type: "page", method: "POST", path: hostilePath, createdAt: new Date().toISOString(), duration: 4, sessionId: null }]);
  const hostileStatement = sql.transactions[0][0];
  assert.equal(hostileStatement.text.includes("DROP TABLE"), false);
  assert.ok(hostileStatement.values.includes(hostilePath));
  await repository.saveAnalyticsBatch([{ type: "request", method: "GET", path: "/api/public/history", status: 200, duration: 5, createdAt: new Date().toISOString(), sessionId: "b".repeat(64) }]);
  assert.equal(sql.transactions.length, 2);
  const sqlText = sql.transactions[1].map(statement => statement.text).join("\n");
  assert.match(sqlText, /INSERT INTO request_analytics/);
  assert.match(sqlText, /INSERT INTO visitor_sessions/);
  assert.match(sqlText, /DELETE FROM visitor_sessions WHERE session_identifier IN/);
  assert.equal(sqlText.includes("/api/public/history"), false);
});

test("Neon repository rejects a schema newer than the application supports", async () => {
  const sql = fakeSql();
  sql.query = async text => text.includes("schema_migrations") ? [{ version: 2 }] : [];
  await assert.rejects(createNeonRepository({ sql }).assertSchema(), { code: "DATABASE_SCHEMA_UNSUPPORTED" });
});

test("Neon admin session and rate-limit storage persist hashes and fail with sanitized errors", async () => {
  const sql = fakeSql();
  const repository = createNeonRepository({ sql });
  await repository.createAdminSession("c".repeat(64), new Date(Date.now() + 60_000));
  await repository.consumeRateLimit("d".repeat(64), 60_000, 3);
  assert.ok(sql.queries.some(item => item.text.includes("INSERT INTO admin_sessions") && item.values[0] === "c".repeat(64)));
  assert.ok(sql.queries.some(item => item.text.includes("INSERT INTO rate_limit_buckets") && item.values[0] === "d".repeat(64)));
  const failing = fakeSql();
  failing.query = async () => { throw new Error("secret connection detail"); };
  await assert.rejects(createNeonRepository({ sql: failing }).ping(), error => {
    assert.equal(error.code, "DATABASE_OPERATION_FAILED");
    assert.equal(error.message.includes("secret connection detail"), false);
    return true;
  });
});

test("migration runner refuses missing DATABASE_URL before constructing a client", async () => {
  let called = false;
  await assert.rejects(runMigrations({ env: {}, sqlFactory: () => { called = true; } }), { code: "DATABASE_URL_REQUIRED" });
  assert.equal(called, false);
});

const migrationOptions = sql => ({
  env: { DATABASE_URL: "postgresql://synthetic.invalid/test" },
  sqlFactory: () => sql,
  logger: { info() {} }
});

test("migration runner skips an already-applied migration", async () => {
  const sql = migrationSql({ initiallyApplied: [1] });
  const result = await runMigrations(migrationOptions(sql));
  assert.deepEqual(result, { appliedCount: 0, migrationCount: 1 });
  const migration = sql.transactions.find(batch => batch.some(item => item.text.includes("DO $rakib_apply_")));
  assert.ok(migration);
  assert.match(migration.find(item => item.text.includes("DO $rakib_apply_")).text, /IF NOT EXISTS \(SELECT 1 FROM schema_migrations WHERE version = 1\)/);
  assert.equal(sql.applied.size, 1);
});

test("migration runner applies checked-in static SQL and version recording once inside one locked transaction", async () => {
  const sql = migrationSql();
  const result = await runMigrations(migrationOptions(sql));
  assert.deepEqual(result, { appliedCount: 1, migrationCount: 1 });
  assert.equal(sql.applied.has(1), true);
  const migration = sql.transactions.find(batch => batch.some(item => item.text.includes("DO $rakib_apply_")));
  assert.ok(migration);
  assert.match(migration[0].text, /pg_advisory_xact_lock/);
  const block = migration.find(item => item.text.includes("DO $rakib_apply_")).text;
  assert.match(block, /visitors_created_at_idx/);
  assert.match(block, /INSERT INTO schema_migrations/);
  assert.match(block, /UPDATE pg_temp\.rakib_migration_result SET applied = true/);
});

for (const failure of ["statement", "version"]) {
  test(`migration runner rolls back when the ${failure} step fails and redacts details`, async () => {
    const sql = migrationSql();
    sql.failAt = failure;
    await assert.rejects(runMigrations(migrationOptions(sql)), error => {
      assert.equal(error.code, "DATABASE_MIGRATION_FAILED");
      assert.match(error.message, /verify schema_migrations before retrying/);
      assert.equal(error.message.includes("synthetic.invalid"), false);
      return true;
    });
    assert.equal(sql.applied.size, 0);
  });
}

test("migration runner serializes concurrent invocations with a transaction-scoped lock", async () => {
  const sql = migrationSql({ delayMs: 4 });
  const results = await Promise.all([runMigrations(migrationOptions(sql)), runMigrations(migrationOptions(sql))]);
  assert.equal(sql.maxConcurrentTransactions, 1);
  assert.deepEqual(results.map(result => result.appliedCount).sort(), [0, 1]);
  assert.equal(sql.applied.size, 1);
  assert.equal(sql.transactions.filter(batch => batch.some(item => item.text.includes("DO $rakib_apply_"))).length, 2);
});

test("migration SQL splitter respects strings, identifiers, comments, and dollar-quoted blocks", () => {
  const source = [
    "-- semicolon; in a line comment",
    "SELECT 'semi;colon', 'doubled '' quote; still text', E'escaped \\\' quote; still text';",
    'SELECT "identifier;name" FROM example; /* nested ; comment /* inner ; */ end */ SELECT 2;',
    "DO $tag$ BEGIN RAISE NOTICE 'inside; block'; END $tag$;",
    "SELECT 3; -- trailing comment; ignored"
  ].join("\n");
  const statements = splitMigrationSql(source);
  assert.equal(statements.length, 5);
  assert.match(statements[0], /^-- semicolon;/);
  assert.match(statements[2], /SELECT 2/);
  assert.match(statements[3], /^DO \$tag\$/);
  assert.match(statements[4], /SELECT 3/);
  assert.throws(() => splitMigrationSql("SELECT 'unterminated"), /unterminated/);
});

test("migration runner can retry safely after a rolled-back failure", async () => {
  const sql = migrationSql();
  sql.failAt = "statement";
  await assert.rejects(runMigrations(migrationOptions(sql)), { code: "DATABASE_MIGRATION_FAILED" });
  assert.equal(sql.applied.size, 0);
  sql.failAt = null;
  assert.deepEqual(await runMigrations(migrationOptions(sql)), { appliedCount: 1, migrationCount: 1 });
  assert.equal(sql.applied.has(1), true);
});

test("versioned schema defines required durable tables and never defines a plaintext IP column", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "src", "db", "migrations", "001_initial.sql"), "utf8");
  for (const table of ["visitors", "request_analytics", "page_analytics", "security_analytics", "visitor_sessions", "admin_sessions", "schema_migrations", "rate_limit_buckets"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(migration, /ip_hash char\(64\)/);
  assert.match(migration, /payload jsonb/);
  assert.doesNotMatch(migration, /\bip\s+(?:inet|text|varchar)\b/i);
  assert.match(migration, /visitor_sessions_session|visitor_sessions_last_seen/);
  assert.match(migration, /admin_sessions_expires_at_idx/);
});
