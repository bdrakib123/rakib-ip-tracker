"use strict";

require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { neon } = require("@neondatabase/serverless");

const MIGRATION_LOCK_ID = 4_927_018_301;

function splitMigrationSql(source) {
  const statements = [];
  let start = 0;
  let index = 0;
  let hasSql = false;
  let state = "normal";
  let blockDepth = 0;
  let dollarQuote = null;
  let escapeString = false;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (char === "\n" || char === "\r") state = "normal";
      index += 1;
      continue;
    }
    if (state === "block-comment") {
      if (char === "/" && next === "*") { blockDepth += 1; index += 2; continue; }
      if (char === "*" && next === "/") {
        blockDepth -= 1;
        index += 2;
        if (!blockDepth) state = "normal";
        continue;
      }
      index += 1;
      continue;
    }
    if (state === "single-quote") {
      if (escapeString && char === "\\") { index += Math.min(2, source.length - index); continue; }
      if (char === "'" && next === "'") { index += 2; continue; }
      if (char === "'") state = "normal";
      index += 1;
      continue;
    }
    if (state === "double-quote") {
      if (char === '"' && next === '"') { index += 2; continue; }
      if (char === '"') state = "normal";
      index += 1;
      continue;
    }
    if (state === "dollar-quote") {
      if (source.startsWith(dollarQuote, index)) {
        index += dollarQuote.length;
        state = "normal";
        dollarQuote = null;
      } else index += 1;
      continue;
    }

    if (char === "-" && next === "-") { state = "line-comment"; index += 2; continue; }
    if (char === "/" && next === "*") { state = "block-comment"; blockDepth = 1; index += 2; continue; }
    if (char === "'") {
      const prefix = source[index - 1];
      escapeString = (prefix === "e" || prefix === "E") && !/[\w$]/.test(source[index - 2] || "");
      hasSql = true;
      state = "single-quote";
      index += 1;
      continue;
    }
    if (char === '"') { hasSql = true; state = "double-quote"; index += 1; continue; }
    if (char === "$") {
      const delimiter = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        hasSql = true;
        dollarQuote = delimiter;
        state = "dollar-quote";
        index += delimiter.length;
        continue;
      }
    }
    if (char === ";") {
      if (hasSql) statements.push(source.slice(start, index).trim());
      start = index + 1;
      hasSql = false;
      index += 1;
      continue;
    }
    if (!/\s/.test(char)) hasSql = true;
    index += 1;
  }

  if (state !== "normal" && state !== "line-comment") {
    throw new TypeError("Migration SQL contains an unterminated string, identifier, comment, or dollar-quoted block.");
  }
  if (hasSql) statements.push(source.slice(start).trim());
  return statements;
}

function dollarQuote(value, label) {
  let suffix = 0;
  let delimiter = `$${label}$`;
  while (value.includes(delimiter)) delimiter = `$${label}_${++suffix}$`;
  return `${delimiter}${value}${delimiter}`;
}

function conditionalMigration(version, statements) {
  const ddl = statements.map((statement, index) =>
    `    EXECUTE ${dollarQuote(statement, `rakib_ddl_${version}_${index}`)};`).join("\n");
  const body = `BEGIN\n  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ${version}) THEN\n${ddl}\n    INSERT INTO schema_migrations (version) VALUES (${version});\n    UPDATE pg_temp.rakib_migration_result SET applied = true;\n  END IF;\nEND`;
  return `DO ${dollarQuote(body, `rakib_apply_${version}`)}`;
}

function safeMigrationError(version, cause) {
  const error = new Error(`Migration ${version} did not complete. Database errors are redacted; verify schema_migrations before retrying.`);
  error.code = "DATABASE_MIGRATION_FAILED";
  error.cause = cause;
  return error;
}

function safePreflightError(stage, cause) {
  const error = new Error(`Database migration ${stage} failed. Database errors are redacted; verify the isolated target and retry only after review.`);
  error.code = `DATABASE_MIGRATION_${stage.toUpperCase()}_FAILED`;
  error.cause = cause;
  return error;
}

async function runMigrations({ env = process.env, sqlFactory = neon, migrationDir = path.join(__dirname, "..", "src", "db", "migrations"), logger = console } = {}) {
  const databaseUrl = String(env.DATABASE_URL || "");
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    const error = new Error("DATABASE_URL is required and must be a PostgreSQL connection URL.");
    error.code = "DATABASE_URL_REQUIRED";
    throw error;
  }
  const sql = sqlFactory(databaseUrl);
  if (typeof sql.transaction !== "function") {
    const error = new Error("The installed database driver does not support atomic HTTP transactions required for migrations.");
    error.code = "DATABASE_TRANSACTIONS_UNAVAILABLE";
    throw error;
  }
  const files = (await fs.readdir(migrationDir)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
  const knownVersions = files.map(name => Number(name.match(/^(\d+)/)[1]));
  let versions;
  try {
    await sql.transaction(tx => [
      tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`,
      tx`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    ]);
    versions = await sql.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1");
  } catch (cause) {
    throw safePreflightError("preflight", cause);
  }
  if (versions.length && Number(versions[0].version) > Math.max(0, ...knownVersions)) {
    const error = new Error("Database schema contains a migration newer than this application; refusing downgrade.");
    error.code = "DATABASE_SCHEMA_UNSUPPORTED";
    throw error;
  }
  let appliedCount = 0;
  for (const file of files) {
    const version = Number(file.match(/^(\d+)/)[1]);
    const source = await fs.readFile(path.join(migrationDir, file), "utf8");
    const statements = splitMigrationSql(source);
    let result;
    try {
      // The version check and static DDL run conditionally under the same transaction lock.
      result = await sql.transaction(tx => [
        tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`,
        tx`CREATE TEMP TABLE IF NOT EXISTS rakib_migration_result (applied boolean NOT NULL) ON COMMIT DROP`,
        tx`INSERT INTO pg_temp.rakib_migration_result (applied) VALUES (false)`,
        tx`${tx.unsafe(conditionalMigration(version, statements))}`,
        tx`SELECT applied FROM pg_temp.rakib_migration_result`
      ]);
      if (result.at(-1)?.[0]?.applied) appliedCount += 1;
    } catch (cause) {
      throw safeMigrationError(version, cause);
    }
    if (result.at(-1)?.[0]?.applied) logger.info?.(`Applied database migration ${version}.`);
  }
  return { appliedCount, migrationCount: files.length };
}

if (require.main === module) {
  runMigrations().then(result => {
    console.log(`Database migrations complete (${result.appliedCount} applied, ${result.migrationCount} known).`);
  }).catch(error => {
    console.error(JSON.stringify({ level: "error", event: "database_migration_failed", code: error.code || "DATABASE_MIGRATION_FAILED" }));
    process.exitCode = 1;
  });
}

module.exports = { MIGRATION_LOCK_ID, runMigrations, splitMigrationSql };
