# Vercel + Neon Migration Audit

**Scope:** V3.0.0 root application inspected before implementation. No Vercel project, Neon database, production service, or production visitor data was accessed. Render configuration is a separate deployment target and must remain unchanged.

## Initial verdict

**INCOMPATIBLE AS-IS; migration is feasible with a shared PostgreSQL adapter and serverless lifecycle changes.** Adding `vercel.json` alone would not make the present application safe on Functions. Code-level compatibility and mocked tests can be implemented locally; real Neon behavior and Vercel routing/proxy behavior remain unverified until isolated owner-created staging resources are available.

## Component inventory

| Component | Current implementation | Serverless concern | Migration path |
|---|---|---|---|
| `src/server.js` | Loads env, opens storage, builds services/app, calls `app.listen`, registers SIGTERM/SIGINT, closes queue/repository | A Function must export an app/handler and not open a listener or rely on shutdown callbacks | Retain Render `start()`; add a lazy Vercel app bootstrap and export Express app/handler |
| `src/app.js` | Express APIs, static middleware, admin routes, telemetry finish hooks, SSE | Static middleware is not served by Vercel's Express adapter; finish-hook telemetry is not awaited; SSE holds process-local clients | Keep API middleware; CDN static files from `public`; bound live refresh to authenticated polling; await request telemetry |
| `src/config.js` | Requires admin password and 64-hex encryption key; production JSON mount and proxy count validation; staging gates | Needs an explicit Vercel database mode; must not inherit JSON fallback or Render proxy trust assumptions | Add Vercel/Postgres validation with `DATABASE_URL` and an explicit deployment mode |
| `src/db/jsonFileRepository.js` | Versioned JSON, encrypted IP payload, hashing, lock, atomic replacement, 64 MiB limit, analytics embedded | Local files/locks are not shared durable storage across Function instances | Keep for Render; implement a PostgreSQL repository satisfying the same async interface |
| `src/db/storage.js` | Enforces persistent mount, staging-only temp directory | Vercel cannot use either mode for durable production requests | Route explicit Vercel mode only to PostgreSQL; missing DB fails startup/request initialization |
| `src/db/storageBackup.js`, `scripts/storageBackup.js` | Local-file backup/list/verify/interactive restore | File-oriented CLI/restore cannot safely target Neon or run as a Function | Retain Render commands; define DB backup/restore operationally via provider-managed procedures, not public routes |
| `src/auth/adminAuth.js` | Admin sessions and failed staging auth in `Map`; admin token held as cookie | Instances/cold starts do not share session state | Store only hashes of random tokens in PostgreSQL and validate expiration on requests; staging gate remains a Render staging facility |
| `src/lib/rateLimit.js` | In-memory map and opportunistic cleanup | Per-instance limits can be bypassed by scaling/cold starts | PostgreSQL atomic fixed-window counters; DB failures fail closed for protected/high-risk actions |
| `src/services/adminAnalytics.js` | Queue + timer to batch JSON analytics; process-local waiters | Timer/unawaited writes may be terminated with a Function; state differs per instance | Repository-backed analytics writes awaited in request lifecycle; bounded polling for updates |
| `src/services/visitorService.js` | Independent geo/device collection, AES-256-GCM IP encryption, keyed IP hashes, repository interface, local EventEmitter | EventEmitter only reaches same process; storage methods are async and portable | Keep service interface; emit no cross-instance event assumption; use database operations |
| `src/geolocation/*`, `src/device/*`, `src/lib/validateClientSignals.js`, `src/lib/ip.js` | Provider lookup, parsing, IP handling, client validation | Generally request-compatible; geo provider requests consume invocation duration | Reuse with bounded timeout/retries; verify client IP extraction separately for Vercel |
| `public/*` | Browser dashboard/admin, relative same-origin APIs, Leaflet CDN, admin `EventSource` | Vercel serves `public/**` via CDN; Express static ignored; SSE relies on persistent server clients | Keep assets in public; replace EventSource with bounded authenticated polling |
| Render `render.yaml` | Single process, persistent `/var/data` disk | Not a Vercel config | Leave unchanged |
| Render `render-free-staging.yaml` | Explicit disposable temp storage and Basic Auth | Not a Vercel config | Leave unchanged |
| Tests | Node test suite with repository fakes and temporary JSON fixtures | No real Postgres/Function platform tests exist | Add adapter mocks, SQL contract tests, serverless bootstrap tests, and preserve Render coverage |

## Cross-cutting dependencies found

- `app.listen()` and process signal handlers occur in `src/server.js`; tests also call `listen()` intentionally to exercise HTTP behavior.
- JSON filesystem writes and exclusive lock are implemented in `src/db/jsonFileRepository.js`; mount checks and temp staging initialization are in `src/db/storage.js`; backup/restore writes are in `src/db/storageBackup.js`.
- Admin session map and staging credential-failure map are in `src/auth/adminAuth.js`; public/login limit buckets are in `src/lib/rateLimit.js`.
- Request counts, SSE client set, and timers are in `src/app.js` and `src/services/adminAnalytics.js`; visitor notifications use an `EventEmitter` in `src/services/visitorService.js`.
- `express.static()` and `sendFile()` serve `public/**` from `src/app.js`.
- Analytics are queued from response `finish` and flushed on a timer/Render shutdown; Function requests require awaited persistence or a supported lifecycle wait primitive.
- API surface includes public intelligence/history/tracking, admin login/logout/history/detail/analytics/health/export/clear, legacy aliases, and authenticated live routes.

## Required migration safeguards

1. Keep `render.yaml` and `render-free-staging.yaml` unchanged.
2. Add a PostgreSQL adapter, versioned SQL migrations, and strict `DATABASE_URL` configuration; never silently fall back to JSON in Vercel mode.
3. Preserve encrypted IP payloads and keyed hashes; schema must contain no plaintext IP column.
4. Convert admin auth and rate limiting to shared DB-backed operations; errors must not silently grant access or disable limits.
5. Replace indefinitely open SSE with bounded, authenticated polling. Durable analytics writes must complete before the response succeeds.
6. Keep static assets in `public/` and verify that the Vercel Function routes do not shadow those assets.
7. Preserve Render startup and file-backup behavior independently.

## Verification boundary

Local automated tests can validate schema SQL, parameterization, repository behavior under mocks, auth/rate-limit semantics, no plaintext IP persistence, and application contract compatibility. A real isolated Neon database is required to validate driver transactions, migrations, concurrent database operations, and Neon connection behavior. A Vercel Preview deployment is required to validate Function routing, static asset delivery, request-IP metadata, cold starts, and dashboard environment setup. These external checks are not performed in this work.

## Official platform references checked 2026-11-19

- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express): Express is packaged as a Function; `express.static()` is ignored; place static assets in `public/`.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations): finite duration, request/response payload and runtime limits apply.
- [Vercel streaming](https://vercel.com/docs/functions/streaming-functions): response streaming exists but does not make process-local SSE subscriptions durable.
- [Neon Serverless driver](https://neon.com/docs/serverless/serverless-driver): `neon()` HTTP queries and non-interactive batch transactions are used; `@neondatabase/serverless` requires Node 19+.
- [Neon/Vercel integration overview](https://neon.com/docs/guides/vercel-overview): Marketplace integration choices and environment wiring.

## Implementation result

The audit findings drove the root-level Vercel entry, `vercel.json`, Neon repository, version 1 SQL migration, manual migration runner, Vercel-only config validation, persisted admin sessions, shared PostgreSQL rate limits, awaited page-view writes, `waitUntil`-attached request telemetry, and authenticated bounded live polling. The PostgreSQL session table is capped at 1,000 records, matching the existing JSON analytics limit, and startup rejects schema versions newer than the adapter supports. Render `render.yaml`, `render-free-staging.yaml`, and the JSON repository lifecycle remain separate and unchanged.

Local verification on 2026-11-20 passed `npm ci` (102 packages added, 103 audited), `npm run check`, `npm test` (**123/123**), `npm ls --omit=dev --depth=0` (the five expected production dependencies), `npm audit --omit=dev` (**0 vulnerabilities**), and `git diff --check`. A focused remediation added analytics synchronization/order, migration transaction safety, atomic metadata initialization, CSP, and strict Vercel storage-backend configuration checks. Neon repository and migration tests use mocked SQL only; no actual SQL was sent to Neon. Local checks do not prove Neon transaction behavior, Vercel routing, cold starts, or request-IP forwarding. An access-protected Preview may bootstrap with explicit `TRUST_PROXY_HOPS=0` (which trusts no forwarded headers and may see the Vercel edge as the client); a production trust value remains **BLOCKED — proxy topology unverified**. JSON-to-Postgres historical data transfer and Neon backup/restore are not implemented or performed. No Neon, Vercel Preview, production proxy topology, backup/PITR, or deployed restore behavior has been verified. The overall migration is prepared for isolated Preview validation, not production approval.
