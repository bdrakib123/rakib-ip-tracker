# Neon PostgreSQL Setup for Vercel

This is an owner-run procedure. No database or account was created for this change. Vercel mode requires the explicit `STORAGE_BACKEND=neon-postgres` setting; missing or unsupported values fail configuration and never fall back to JSON or MongoDB.

## Connection model

V3 Vercel mode requires the explicit `STORAGE_BACKEND=neon-postgres` setting and uses `@neondatabase/serverless`'s `neon(DATABASE_URL)` HTTP driver. Missing or unsupported backend values fail configuration and never fall back to JSON or MongoDB. Single queries use parameterized `sql.query(text, values)` calls; multi-statement consistency operations use the driver's HTTP `sql.transaction([...])` batch transaction API. No long-lived TCP pool is held between Function invocations. `DATABASE_URL` is read only in Vercel mode and is never logged.

The app validates the database schema at initialization. It does **not** create tables automatically. Apply versioned SQL files in `src/db/migrations/` explicitly before launching the app.

## Marketplace setup

1. In the Vercel project, open **Integrations / Marketplace** and choose the current Neon Postgres integration. Vercel/Neon currently document Vercel-managed and Neon-managed integration choices; choose based on account ownership and billing preference.
2. Connect a dedicated Neon project/database. Do not reuse an unrelated database or any GoatBot/legacy database.
3. Configure separate Neon branches/connections for Vercel Preview and Production. Ensure each Vercel environment receives only its matching `DATABASE_URL`.
4. Verify the branch/database identity in the Neon console before applying migrations. Do not copy the connection string into a shell command, report, Git file, screenshot, or chat.
5. Apply the migration using a secret manager or trusted runtime that injects `DATABASE_URL` into the process without echoing it:

   ```sh
   npm run migrate:neon
   ```

6. The migration runner applies repository-owned static SQL and records each version in one Neon HTTP transaction, protected by a transaction-scoped PostgreSQL advisory lock. The installed driver documents `sql.transaction()` as a non-interactive transaction batch. Concurrent runners serialize; DDL and version recording commit or roll back together. Checked-in DDL is idempotent for retry after an unknown network outcome. The runner prints migration numbers only and redacts errors; inspect `schema_migrations` before retrying an ambiguous connection failure.
7. Verify `schema_migrations` contains version 1 and the expected tables/indexes exist. Do not query visitor payloads for a schema check.
8. Deploy Preview only after migration succeeds. If app startup says `DATABASE_SCHEMA_NOT_READY`, stop and investigate; do not switch to JSON or temp storage.

The command must run only after confirming the injected `DATABASE_URL` targets the intended isolated Preview branch. Do not execute it against a production branch before a separately approved release/cutover.

## Version 1 schema

`001_initial.sql` creates:

- `visitors`: opaque record ID, created timestamp, keyed IP hash, country, device category, analytics session ID, and validated JSONB payload. The payload constraint rejects a top-level plaintext `ip` field. The visitor service stores the existing AES-256-GCM IP payload and HMAC hash; the encryption key is never stored in the database.
- `request_analytics`, `page_analytics`, `security_analytics`: bounded event rows and timestamp/session indexes; no raw IP, cookies, tokens, user-agent, referrer, or sensitive headers.
- `visitor_sessions`: keyed session identifier, created/last-seen timestamps, request count and first path. IP hash/user-agent/referrer columns exist for schema compatibility but are not populated by this implementation.
- `admin_sessions`: SHA-256 token hash and expiration only.
- `rate_limit_buckets`: HMAC-derived bucket hash, window start and atomic count.
- `schema_migrations`, `analytics_metadata`: schema version and honest collection-start metadata.

Indexes cover visitor creation time, IP hash, country, device category and session identifier; analytics creation time/session; visitor-session last-seen; admin-session expiration; and rate-limit windows. Analytics retention is 30 days with caps of 5,000 request events, 2,000 page events, 1,000 security events, and 1,000 visitor sessions. Startup rejects an unapplied or newer unsupported schema version.

## JSON data and backups

There is no automatic migration from Render JSON storage to Neon and no database import command. The app does not read `/var/data` in Vercel mode. A cutover requires a separate owner-approved, encrypted transfer plan that preserves the existing key/data compatibility and validates counts without exposing records. Do not point Vercel at Render's disk.

The existing `npm run backup` tool is JSON-file-only and must not be used as a Neon backup. Configure Neon-managed backup/PITR according to the selected plan, confirm retention and restore capabilities in Neon, and run a separate isolated restore drill before production use. Those provider settings remain unverified.

Official references checked 2026-11-19: [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) and [Neon/Vercel integration overview](https://neon.com/docs/guides/vercel-overview).
