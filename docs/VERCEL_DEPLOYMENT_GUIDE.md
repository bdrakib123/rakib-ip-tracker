# Vercel Deployment Guide — V3.0.0

**Status: implementation prepared; Vercel and Neon deployment not verified. Production remains NO-GO.** This guide does not deploy or provision services.

## Runtime shape

- Vercel recognizes the Express application exported from `src/index.js`. That entry exports an Express app and does not call `listen()`.
- `npm start` remains the Render entry (`src/server.js`) and keeps the Render JSON/disk behavior.
- Vercel mode is selected only by the platform-provided `VERCEL=1`. It requires `STORAGE_BACKEND=neon-postgres`, `DATABASE_URL`, and an explicitly configured `TRUST_PROXY_HOPS`. It rejects file paths, staging temp mode, and MongoDB settings. There is no JSON fallback.
- The first Function request initializes one shared promise per warm instance, opens the Neon HTTP driver, verifies the schema version, and creates the Express app. Failed initialization returns a sanitized 503 and may retry on a later invocation. No process signal handler or database socket pool is started.
- Static assets stay under `public/` for Vercel's CDN. Vercel ignores Express `express.static()`; `/admin` and `/admin-panel` rewrite to `/admin.html`. API routes and `/healthz` reach the Express Function.
- Live dashboard refresh is authenticated bounded polling (20 seconds), not an open SSE stream. Render file storage is untouched.

## Vercel project settings

1. In the Vercel Dashboard, create a project connected to the reviewed GitHub repository and intended branch. Do not select a Render deployment configuration as a Vercel build system.
2. Set Root Directory to repository root. Use the `vercel.json` already in the root; do not add a catch-all rewrite that sends `public/**` through Express.
3. Use the Node.js runtime selected by Vercel that satisfies `package.json` (`>=20.18.1`). Confirm the actual selected Node version in project/build output.
4. Connect Neon through the Vercel Marketplace as described in `VERCEL_DATABASE_SETUP.md`. Use separate database branches/credentials for Preview and Production.
5. For an isolated, access-protected Preview bootstrap only, configure `TRUST_PROXY_HOPS=0`. This explicitly disables trust in forwarding headers, so the app may see the Vercel edge address instead of the test client's address; use synthetic requests and do not treat IP geolocation or per-client rate-limit results as representative. Verify the real Preview proxy chain using the procedure in `VERCEL_SECURITY_REVIEW.md`, then select a hop count from evidence. Do not enable public/production traffic with an unverified value.
6. Review Preview build and runtime logs for sanitized status/error codes only. Never copy environment output, connection strings, visitor records, IPs, cookies, or headers into tickets.

## Environment variables

| Variable | Required | Secret | Value/validation |
|---|---:|---:|---|
| `NODE_ENV` | Yes | No | `production` for Vercel production and Preview runtime behavior. |
| `DATABASE_URL` | Yes | **Yes** | Injected by the Neon integration for the matching Vercel environment; must be a PostgreSQL URL. Never copy between unrelated databases. |
| `STORAGE_BACKEND` | Yes | No | `neon-postgres`. Any other Vercel backend fails configuration. |
| `ADMIN_PASSWORD` | Yes | **Yes** | Unique per environment; at least 16 characters. |
| `IP_ENCRYPTION_KEY` | Yes | **Yes** | Unique per environment; exactly 64 hex characters (32 bytes). Keep consistent with data encrypted under that key. |
| `TRUST_PROXY_HOPS` | Yes | No | Integer 0–10. For isolated Preview bootstrap use explicit `0` (trust no forwarding headers), with deployment access protection and synthetic requests. Before any real visitor traffic, validate Preview ingress and spoofed forwarding headers and set the evidence-backed value. Vercel startup rejects omission. |
| `GEO_PROVIDER` | Optional | No | `ipwho.is` (the only configured provider). |
| `GEO_TIMEOUT_MS` | Optional | No | Defaults 5000; bounded 500–15000. |
| `GEO_RETRY_COUNT` | Optional | No | Defaults 1; bounded 0–2. |
| `PUBLIC_RATE_LIMIT` | Optional | No | Defaults 30; bounded 5–300 per minute. |
| `LOGIN_RATE_LIMIT` | Optional | No | Defaults 5; bounded 2–20 per 15 minutes. |
| `PORT` | No | No | Managed by Vercel; the Function entry does not bind a port. |
| `VERCEL` | Platform-provided | No | Vercel injects `1`; do not manually enable this on Render. |

Do not set `STAGING_MODE`, `STAGING_EPHEMERAL_STORAGE`, `STAGING_STORAGE_DIR`, `STORAGE_FILE`, `STORAGE_MOUNT_PATH`, `BACKUP_DIR`, or MongoDB variables in Vercel mode. The Render files `render.yaml` and `render-free-staging.yaml` remain unchanged.

## Database migration and release order

1. Connect a dedicated Neon database/branch to **Preview** first and supply `DATABASE_URL` through the Vercel/Neon integration.
2. In a trusted environment with only that Preview connection injected, run `npm run migrate:neon`. This is a manual command; application cold starts never run DDL or migrations.
3. Verify migration version 1 in the Neon SQL console without selecting visitor payloads or exposing credentials. Verify the database branch identity before any command.
4. Deploy a Vercel Preview and test health, authentication, synthetic visitor insert/history, analytics, rate limiting, and static assets. The repository suite uses mocks and is not a real Neon integration test.
5. Create/attach the separate Production Neon branch only after the owner approves the cutover and data migration plan. Run migrations against the verified intended branch before deploying code that requires the schema.
6. The current Render JSON visitor data is not automatically copied. Do not import it casually: an owner-approved encryption-key/data-transfer and reconciliation procedure is required. No production records were accessed by this work.

The current local backup/restore CLI only handles JSON files. It is not a Neon backup mechanism and must not be run against a Vercel environment. Select and verify Neon backup/PITR/export policy for the actual Neon plan; no independent backup or restore drill is configured here.

## Health and operational behavior

- `GET /healthz` performs a safe database `SELECT 1`; it returns only healthy/unavailable status and no internal metadata.
- Missing `DATABASE_URL`, missing/invalid `TRUST_PROXY_HOPS`, unsupported storage mode, or unapplied migrations fail closed. Runtime responses do not include connection details. `0` is a safe no-forwarded-header-trust bootstrap, but it can identify the Vercel edge as the client; it is not approval for production traffic.
- Admin session records store only SHA-256 token hashes. Shared rate-limit buckets store keyed hashes, not raw IP values. Database errors do not grant access or bypass limits; rate-limited routes return 503 if shared protection is unavailable.
- Analytics writes from response completion are registered with Vercel `waitUntil`; page-view writes are awaited. This is best-effort within Function lifetime and is not an independent queue. Inspect runtime errors and verify writes in Preview.
- `GET /api/admin/live` and the legacy `/api/live` alias now return bounded JSON polling metadata instead of `text/event-stream`. The browser refreshes admin overview/history at 20-second intervals while visible. Existing API response contracts otherwise remain in place.

## Limitations and gate

No real Neon database, Vercel Preview, proxy chain, Marketplace integration, or dashboard environment was tested. The JSON-to-Postgres data migration is not implemented. The application is **not production-ready** until Preview DB integration, proxy trust, migration/recovery, secrets, and UI/API verification are owner-verified.

Official references checked 2026-11-19: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), and [Neon + Vercel integration choices](https://neon.com/docs/guides/vercel-overview).
